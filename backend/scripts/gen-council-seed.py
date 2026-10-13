# docs/council の議事録と未決の問いを backend/src/company/councilSeed.ts に埋め込む（本番には docs が無いため）
# 実行: python backend/scripts/gen-council-seed.py
import os, glob

root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def esc(s: str) -> str:
    return s.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')


items = []
for p in sorted(glob.glob(os.path.join(root, 'docs', 'council', '20*.md'))):
    key = os.path.splitext(os.path.basename(p))[0]
    items.append((key, open(p, encoding='utf-8').read()))
readme = open(os.path.join(root, 'docs', 'council', 'README.md'), encoding='utf-8').read()
oq = readme.split('## 未決の問い（優先順）')[1].strip()
items.append(('open-questions', '# 未決の問い（優先順）\n\n' + oq))

out = '// 会議室の初期データ（docs/council から生成。直すときは docs を直してから backend/scripts/gen-council-seed.py を実行）\n'
out += 'export const COUNCIL_SEED: { key: string; content: string }[] = [\n'
out += ',\n'.join("  { key: '%s', content: `%s` }" % (k, esc(c)) for k, c in items)
out += '\n];\n'
open(os.path.join(root, 'backend', 'src', 'company', 'councilSeed.ts'), 'w', encoding='utf-8').write(out)
print('ok', len(items))
