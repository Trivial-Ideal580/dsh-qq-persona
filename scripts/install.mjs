#!/usr/bin/env node
/**
 * 把 dsh-qq-persona 装进一个 dsh profile。
 *
 *   node scripts/install.mjs --profile qqbot
 *   node scripts/install.mjs --profile qqbot --dsh-home D:\dsh-home
 *   node scripts/install.mjs --profile qqbot --uninstall
 *
 * 不需要 pnpm，也不联网。重复执行是安全的（配置没变就不写、不备份）。
 */
import { installPlugin, uninstallPlugin } from './install-lib.mjs';

function parseArgs(argv) {
  const options = {
    profile: 'qqbot',
    dshHome: process.env.DSH_HOME,
    uninstall: false,
    keepOfficial: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--profile') options.profile = argv[++i];
    else if (arg === '--dsh-home') options.dshHome = argv[++i];
    else if (arg === '--uninstall') options.uninstall = true;
    else if (arg === '--keep-official') options.keepOfficial = true;
    else if (arg === '--quiet' || arg === '-q') options.quiet = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数 ${arg}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法：node scripts/install.mjs [--profile qqbot] [--dsh-home PATH] [--keep-official] [--uninstall] [--quiet]');
    return;
  }

  if (options.uninstall) {
    const result = uninstallPlugin(options);
    if (!result.ok) {
      console.error(`✖ ${result.error}`);
      process.exit(1);
    }
    console.log(`✔ 已从 profile "${options.profile}" 移除 dsh-qq-persona`);
    return;
  }

  const result = installPlugin(options);
  if (!result.ok) {
    console.error(`✖ ${result.error}`);
    process.exit(1);
  }
  if (options.quiet) {
    if (result.changed) console.log(`✔ 已更新 profile "${options.profile}" 的 bundles`);
    return;
  }

  console.log(`✔ 已复制插件 → ${result.targetDir}`);
  if (result.changed) {
    console.log(`✔ bundles = ${result.bundles.join(' → ')}`);
    console.log(`  旧配置备份：${result.backup}`);
  } else {
    console.log(`✔ bundles 已是 ${result.bundles.join(' → ')}，无需修改`);
  }
  if (result.connectorMissing) {
    console.warn('\n⚠ 这个 profile 里没有 @tencent-connect/qqbot-nodejs。');
    console.warn(`  先运行：dsh plugin --profile ${options.profile} add @tencent-connect/qqbot-nodejs\n`);
  }
  console.log('\n下一步：');
  console.log('  1. 双击 启动工作台.cmd —— 在浏览器里填凭据、调人设、点启动');
  console.log(`  2. 或者手动：dsh --profile ${options.profile}`);
}

main();
