# Mayhem 格式记录剩余部分：复核结果

本次新增可计数字节 **0**。`[720330,720344)`、`[720348,720360)`、`[720372,720376)` 共 30 字节与候选映像相同，但没有找到可以证明这些字节被读取的路径，因此全部保留为未覆盖；可选的 `[719929,719932)` 也未计入。前一份证明的 18 字节仅用作排重，不在本包重新计数。

复核原始与候选映像的格式化路径：两份记录地址分别为 720328 和 700768。扫描两份 `.text` 中的 64 位立即数装载指令，指向各自 48 字节记录的直接引用各有一处；这只能排除扫描范围内的其他直接装载，不能排除间接计算地址。记录读取路径的复核沿用 `reference_trace.py`，其中记录数量为 1，两个相关判别值为 2；前置输出回调被调用时，路径以回调成功为条件。相同的原始字节、结构大小、对齐和邻接关系都不能单独证明读取，也不声称运行结果相同。

执行验证：

```sh
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.12 -B research/mayhem-current437-format-record-remainder-20261029/verify.py --repo .
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.12 -B research/mayhem-current437-format-record-remainder-20261029/test_verify.py
```

归属：OpenAI / gpt-6.1-terra / codex-cli / high。`reference_trace.py` 复用前一份格式记录证明中的静态路径核查，仅作为排重和复核依据。
