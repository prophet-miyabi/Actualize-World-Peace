# 表現の統一: 「AI」→「AWP」、AI という概念そのものを指すときは「intelligence」、「おしゃべり」→「チャット」。
# 日本語の文脈にある "AI" だけを置き換える（識別子・環境変数・URL・英単語の一部は触らない）。
# 実行: python backend/scripts/brand-words.py [--apply]
import os, re, sys, glob

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
APPLY = '--apply' in sys.argv
JP = r'[぀-ヿ㐀-鿿！-｠「」『』（）・、。]'

# 概念としての AI → intelligence（先に適用。長い語から）
CONCEPT = [
    ('AIの利用枠', 'intelligence の利用枠'), ('AI利用枠', 'intelligence 利用枠'), ('AIの利用量', 'intelligence の利用量'), ('AIの利用状況', 'intelligence の利用状況'), ('AIの利用', 'intelligence の利用'), ('AI利用', 'intelligence 利用'),
    ('AIの費用', 'intelligence の費用'), ('AI費用', 'intelligence 費用'), ('AIのコスト', 'intelligence のコスト'),
    ('AI接続', 'intelligence 接続'), ('AIにつながっていません', 'intelligence につながっていません'), ('AIにつながら', 'intelligence につながら'), ('AIが止まっている', 'intelligence が止まっている'), ('AIが使えません', 'intelligence が使えません'), ('AIが使えない', 'intelligence が使えない'), ('AIが復旧', 'intelligence が復旧'),
    ('AI（Claude）', 'intelligence（Claude）'), ('AIのAPIキー', 'intelligence のAPIキー'), ('AIのクレジット', 'intelligence のクレジット'), ('AIのトークン', 'intelligence のトークン'), ('AIのモデル', 'intelligence のモデル'),
    ('画像生成AI', '画像生成 intelligence'), ('AIの生産性', 'intelligence の生産性'), ('高リスクAI', '高リスク intelligence'), ('AI規制', 'intelligence 規制'),
    ('AIをたっぷり', 'intelligence をたっぷり'), ('AIを惜しみなく', 'intelligence を惜しみなく'), ('AIをしっかり', 'intelligence をしっかり'), ('AIの量', 'intelligence の量'), ('AIを使い', 'intelligence を使い'), ('AIが使え', 'intelligence が使え'), ('AIを日常', 'intelligence を日常'),
    ('今月のAI', '今月の intelligence'), ('AIの上限', 'intelligence の上限'), ('AIの残高', 'intelligence の残高'),
]
# 主体としての AI → AWP（固有の言い回し）
ACTOR = [
    ('AIとおしゃべりしてページをつくる', 'AWPとチャットしてページをつくる'), ('AIとおしゃべりして作る', 'AWPとチャットして作る'), ('AIとおしゃべり', 'AWPとチャット'),
    ('AIチャットボット', 'AWPチャットボット'), ('AIビルダー', 'AWPビルダー'), ('AIエージェント', 'AWPエージェント'), ('AI企業', 'AWP企業'), ('AIオペレーター', 'AWPオペレーター'), ('AI自動入力', 'AWP自動入力'), ('AIアシスタント', 'AWPアシスタント'), ('AI生成', 'AWP生成'), ('AIによる', 'AWPによる'), ('AI受付', 'AWP受付'), ('AIの受付', 'AWPの受付'),
]
SKIP_DIRS = ('node_modules', '.next', 'dist', 'migrations')
TARGETS = [os.path.join(ROOT, 'frontend', 'src'), os.path.join(ROOT, 'backend', 'src')]
EXCLUDE_FILES = {'brand-words.py'}

generic = re.compile(r'(?<![A-Za-z0-9_])AI(?![A-Za-z0-9_])')

def convert(text: str):
    changes = []
    for a, b in CONCEPT + ACTOR:
        if a in text:
            changes.append((a, b, text.count(a)))
            text = text.replace(a, b)
    # 残った「AI」: 前後どちらかが日本語なら AWP
    def repl(m):
        s, e = m.start(), m.end()
        prev = text[s - 1] if s > 0 else ''
        nxt = text[e] if e < len(text) else ''
        if re.match(JP, prev or ' ') or re.match(JP, nxt or ' '):
            return 'AWP'
        return m.group(0)
    new = generic.sub(repl, text)
    if new != text:
        changes.append(('AI(日本語文脈)', 'AWP', sum(1 for _ in generic.finditer(text)) ))
        text = new
    if 'おしゃべり' in text:
        changes.append(('おしゃべり', 'チャット', text.count('おしゃべり')))
        text = text.replace('おしゃべり', 'チャット')
    return text, changes

total = 0
for base in TARGETS:
    for path in glob.glob(os.path.join(base, '**', '*'), recursive=True):
        if not path.endswith(('.ts', '.tsx')) or any(f'{os.sep}{d}{os.sep}' in path for d in SKIP_DIRS):
            continue
        src = open(path, encoding='utf-8').read()
        out, changes = convert(src)
        if out != src:
            n = sum(c[2] for c in changes)
            total += n
            rel = os.path.relpath(path, ROOT)
            print(f'{rel}: {n}  ' + ', '.join(f'{a}→{b}×{c}' for a, b, c in changes[:4]))
            if APPLY:
                open(path, 'w', encoding='utf-8').write(out)
print('total replacements:', total, '(applied)' if APPLY else '(dry run)')
