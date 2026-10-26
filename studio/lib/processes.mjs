/**
 * 清理同一个 profile 的残留机器人进程。
 *
 * 场景：直接关掉工作台的 cmd 窗口时，`cmd /c dsh ...` 的子进程可能活下来，
 * 变成孤儿；它继续占着 QQ 网关，新进程再连就会被反复踢（WebSocket 1006）。
 *
 * 实现：用 PowerShell 读出所有进程的命令行，只匹配
 *   `dsh-desktop-host/lib/cli.js --profile <profile>`
 * 并跳过当前管理中的进程树，其余强制结束。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLI_MARKER = /dsh-desktop-host[\\/]lib[\\/]cli\.js/;

/** 这条命令行是不是“某个 profile 的 dsh CLI”。 */
export function matchesProfileProcess(commandLine, profile) {
  if (!commandLine) return false;
  if (!CLI_MARKER.test(commandLine)) return false;
  const pattern = new RegExp(`--profile\\s+${escapeRegExp(profile)}(\\s|$)`);
  return pattern.test(commandLine);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 解析 PowerShell 输出（可能是数字、数组或空）。 */
export function parseKilledPids(stdout, profile = '') {
  const text = String(stdout ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((item) => Number(item)).filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    // 有些 PowerShell 版本会给单个数字
    const single = Number(text);
    if (Number.isInteger(single) && single > 0) return [single];
    void profile;
    return [];
  }
}

export function buildCleanupScript(profile, keepPid = 0) {
  const profileLiteral = JSON.stringify(String(profile));
  const keep = Number(keepPid) || 0;
  return `$ErrorActionPreference = 'SilentlyContinue'
$profile = ${profileLiteral}
$keep = ${keep}
$all = Get-CimInstance Win32_Process
$byId = @{}
foreach ($proc in $all) { $byId[[int]$proc.ProcessId] = $proc }
function Test-Kept($proc) {
  $cur = $proc
  $guard = 0
  while ($cur -and $guard -lt 20) {
    if ([int]$cur.ProcessId -eq $keep) { return $true }
    $cur = $byId[[int]$cur.ParentProcessId]
    $guard++
  }
  return $false
}
$killed = @()
foreach ($proc in $all) {
  $cmd = [string]$proc.CommandLine
  if ($cmd -notmatch 'dsh-desktop-host[\\\\/]lib[\\\\/]cli\\.js') { continue }
  if ($cmd -notmatch ('--profile\\s+' + [regex]::Escape($profile) + '(\\s|$)')) { continue }
  if ($keep -gt 0 -and (Test-Kept $proc)) { continue }
  try {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
    $killed += $proc.ProcessId
  } catch {}
}
ConvertTo-Json -InputObject @($killed) -Compress
`;
}

async function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024 },
  );
  return stdout;
}

/**
 * @param {{profile: string, keepPid?: number, logger?: object, runner?: Function}} options
 * @returns {Promise<{killed: number[], skipped?: boolean, error?: string}>}
 */
export async function cleanupProfileProcesses({ profile, keepPid = 0, logger, runner } = {}) {
  if (process.platform !== 'win32') return { killed: [], skipped: true };
  const run = runner ?? runPowerShell;
  try {
    const stdout = await run(buildCleanupScript(profile, keepPid));
    const killed = parseKilledPids(stdout, profile);
    if (killed.length > 0) {
      logger?.info?.(`清理残留进程：${killed.join(', ')}`);
    }
    return { killed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn?.(`清理残留进程失败（不影响启动）：${message}`);
    return { killed: [], error: message };
  }
}
