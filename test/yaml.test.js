import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../src/util.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (name) => readFileSync(join(root, 'personas', name), 'utf8');

test('YAML：解析人设的映射、数组、块文本、注释', () => {
  const doc = parseYaml(read('linfi.yaml'));
  assert.equal(doc.id, 'linfi');
  assert.equal(doc.name, '林绯');
  assert.equal(doc.enabled, true);
  assert.ok(Array.isArray(doc.personality));
  assert.equal(doc.personality.length, 4);
  assert.ok(doc.background.includes('焦糖'));
  assert.ok(doc.background.split('\n').length >= 2, '块文本应保留换行');
});

test('YAML：行内数组、示例列表、嵌套 reply', () => {
  const doc = parseYaml(read('xiaoman.yaml'));
  assert.deepEqual(doc.style.catchphrases, ['绝了', '好家伙', '我跟你讲']);
  assert.equal(doc.style.emojiRate, 0.6);
  assert.equal(doc.examples.length, 3);
  assert.equal(doc.examples[0].user, '在干嘛');
  assert.equal(doc.examples[0].assistant, '刚下课！！\n累死了 一会儿还得去店里');
  assert.equal(doc.reply.maxBubbles, 3);
  assert.equal(doc.reply.maxCharsPerBubble, 30);
});

test('YAML：注释和引号里的 # 不会误伤', () => {
  const doc = parseYaml(
    ['a: 1 # 注释', 'b: "带 # 号"', "c: '也带 # 号'", 'd:   ', 'e: [x, "y,z"]'].join('\n'),
  );
  assert.equal(doc.a, 1);
  assert.equal(doc.b, '带 # 号');
  assert.equal(doc.c, '也带 # 号');
  assert.equal(doc.d, null);
  assert.deepEqual(doc.e, ['x', 'y,z']);
});

test('YAML：缩进错误会给出带行号的报错', () => {
  assert.throws(() => parseYaml('a:\n  b: 1\n c: 2'), /第 3 行/);
});
