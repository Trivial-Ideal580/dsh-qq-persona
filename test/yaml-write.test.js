import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizePersona } from '../src/persona.js';
import { parseYaml } from '../src/util.js';
import { compactPersona, personaToYaml, quoteScalar, stringifyYaml } from '../src/yaml-write.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const load = (name) =>
  normalizePersona(parseYaml(readFileSync(join(root, 'personas', name), 'utf8')), name);

const strip = (persona) => {
  const { source, ...rest } = persona;
  return rest;
};

test('人设 YAML round-trip：写出去再读回来是同一个对象', () => {
  for (const name of ['linfi.yaml', 'xiaoman.yaml']) {
    const persona = load(name);
    const yaml = personaToYaml(persona);
    const reparsed = normalizePersona(parseYaml(yaml), 'roundtrip.yaml');
    assert.deepEqual(strip(reparsed), strip(persona), `${name} 写回后不一致`);
  }
});

test('多行示例写回后仍然是一条一个 bubble', () => {
  const persona = normalizePersona(
    {
      id: 'x',
      name: '小 x',
      examples: [{ user: '在吗', assistant: ['在', '怎么了'] }],
    },
    'x.yaml',
  );
  const reparsed = normalizePersona(parseYaml(personaToYaml(persona)), 'y.yaml');
  assert.deepEqual(reparsed.examples, [{ user: '在吗', assistant: ['在', '怎么了'] }]);
});

test('需要引号的标量', () => {
  assert.equal(quoteScalar('普通文本'), '普通文本');
  assert.equal(quoteScalar('a: b'), '"a: b"');
  assert.equal(quoteScalar('#话题'), '"#话题"');
  assert.equal(quoteScalar('- 开头'), '"- 开头"');
  assert.equal(quoteScalar('123'), '"123"');
  assert.equal(quoteScalar('true'), '"true"');
  assert.equal(quoteScalar(''), "''");
  assert.equal(quoteScalar('前后有空格 '), '"前后有空格 "');
});

test('嵌套对象 / 数组 / 块文本的输出结构', () => {
  const yaml = stringifyYaml({
    id: 'demo',
    tags: ['a', 'b'],
    profile: { city: '杭州', note: '第一行\n第二行' },
    empty: [],
  });
  assert.match(yaml, /^id: demo$/m);
  assert.match(yaml, /^tags: \[a, b\]$/m);
  assert.match(yaml, /^profile:$/m);
  assert.match(yaml, /^ {2}city: 杭州$/m);
  assert.match(yaml, /^ {2}note: \|$/m);
  assert.match(yaml, /^empty: \[\]$/m);

  const parsed = parseYaml(yaml);
  assert.equal(parsed.profile.note, '第一行\n第二行');
  assert.deepEqual(parsed.tags, ['a', 'b']);
});

test('compactPersona 去掉空字段但保留 0 / false', () => {
  const compact = compactPersona({
    a: '',
    b: [],
    c: {},
    d: 0,
    e: false,
    f: { g: '', h: 1 },
  });
  assert.deepEqual(compact, { d: 0, e: false, f: { h: 1 } });
});
