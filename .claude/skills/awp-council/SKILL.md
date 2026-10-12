---
name: awp-council
description: AWP 会議室を開く。引数の議題について、心理学・社会学・経済学・地政学・天文学の博士（サブエージェント）が並列に見解を出し、議長が対立点と要件・決定・次の一手にまとめ、議事録（docs/council）と会社メモリに残し、決定をタスクに流す。例: /awp-council UBI を「参加配当」として設計するときの原資と配り方
---

引数: 議題（省略時は `docs/council/README.md` の「未決の問い」から最優先のものを選ぶ）

1. 文脈を読む: `docs/council/README.md`、直近の `docs/council/*.md`、`docs/strategy/vision.md`。本番の数字が要るなら mcp__awp__awp_company_status。
2. 議題を「決めること／決めないこと」に整える（議長 = あなた自身。awp-council-chair の決まりに従う）。
3. Agent で5人を**並列**に呼ぶ: awp-council-psychology, awp-council-sociology, awp-council-economics, awp-council-geopolitics, awp-council-astronomy。全員に同じ議題文＋文脈の要約を渡し、「結論→根拠→AWPへの要件（3つまで）→反対意見への応答→指標」の形で返させる。
4. 対立点の表を作る。重要な対立は、当事者2人だけに相手の主張を渡して反論を求める（2回目、並列）。
5. 統合して書く: 合意した要件（番号付き）／未決（オーナーが決めること、選択肢つき）／次の一手（誰が・いつまでに・成果物）。
6. 保存: `docs/council/YYYY-MM-DD-<slug>.md`（議題・出席・各博士の要約・対立点・合意・未決・次の一手）。README の「開催記録」と「未決の問い」を更新。トークンがあれば mcp__awp__awp_memory_write で `council/YYYY-MM-DD-<slug>` に要約（2,000字以内）を残す。
7. オーナーに報告（結論→根拠→次の一手）。「やって」と言われたら、エージェントの仕事は mcp__awp__awp_create_task、人の仕事は mcp__awp__awp_crew_task で登録する。勝手に作らない。
