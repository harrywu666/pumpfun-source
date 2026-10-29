# Mayhem `.rodata` binary/zeros hole `[713442, 713704)`：复核结果

本次新增可计数字节 **+0**。目标区间 `[713442, 713704)` 共 262 字节仍然全部未覆盖。

区间内容（原始映像 `evidence/original/mayhem/deployed.so`，sha256
`a87fa9f866272514e6acb852b668c4a08aeb173d56c883039991d114d1199bdb`）：

- `[713442, 713538)`：96 字节非 ASCII 二进制，正好是两个连续常量块：
  32 字节（713442）加 64 字节（713474）。
- `[713538, 713704)`：以零为主，含两个 8 字节标记：`u64=9`（713544）与
  `u64=17`（713624）。

## 四类指针，逐类被拒

`.text` 中指向该区间的直接 `lddw` 共 9 处。逐处在 `pc+16` 读取下一条指令：

| 指针 | pc | 后续指令（pc+16） | 类别 | 拒绝原因 |
| ---: | --- | --- | --- | --- |
| 713442 | 29112, 311360, 334240 | `ldxdw` | 32 字节固定偏移比较（pubkey 风格） | 无 mov-imm 长度；4×qword 展开比较不是计数边界 |
| 713474 | 16168, 17072, 18096, 31752 | `ldxdw` | 64 字节固定偏移比较 | 无 mov-imm 长度；8×qword 展开比较不是计数边界 |
| 713544 | 605280 | `call` | 静态 `&usize` 参数 | 9 是值对象，不是被指向字节的长度 |
| 713624 | 606912 | `call` | 静态 `&usize` 参数 | 17 是值对象，不是被指向字节的长度 |

逐条核对硬证据语法：

1. **classic ptr + immediate length**：要求在 `lddw` 的 `pc+16` 有
   `mov-imm` 给出长度。9 处全部是 `ldxdw` 或 `call`，没有任何一处满足。
2. **index-equal rigor**：要求显式 `i < N` 的上界立即数与读取宽度共同限定。
   这些站点是常量偏移比较（`ldxdw` + `jgt/jgt32`），没有索引上界立即数。
3. **未展开的 qword 比较**：32B/64B 匹配块不能单独证明读取长度；没有任何已合并
   的 packet 接受同样的 unrolled-qword 语法来计 `.rodata` 载荷。因此不计。
4. **描述符**：`.data.rel.ro`（地址 725432，大小 7784）中不存在
   `(low=0, high∈区间, length)` 的区间描述符，也不存在 `(pointer, length)`
   指向该区间的二元组。因此不存在间接的长度证明。

扫描器 `reference_trace.py` 重新找到全部 9 处 `lddw`，断言 `pc+16` 均非
`mov64/add64` 立即数指令，并断言 `.data.rel.ro` 描述符扫描为空。`verify.py`
在该 0B 结论上退出 0。

## 仍然开放

仍然开放 **整个** `[713442, 713704)`。本包不重新声明 #851 的区间
`[713022,713108)+[713272,713383)+[713430,713442)+[713704,713808)+[713813,713819)`，
也不重新声明 #879 的 `[713420,713430)`（`src/lib.rs`）。候选映像中 32B/64B
字节相同仅作为排重观察，不作为覆盖依据。

## 验证

```sh
cd /Users/harry/@dev/PMUP/pumpfun-source-opencode
find research/mayhem-current437-binary-zeros-713442-20261029 -name '__pycache__' -delete
PYTHONDONTWRITEBYTECODE=1 python3.12 -B research/mayhem-current437-binary-zeros-713442-20261029/verify.py --repo .
PYTHONDONTWRITEBYTECODE=1 python3.12 -B research/mayhem-current437-binary-zeros-713442-20261029/test_verify.py
PYTHONDONTWRITEBYTECODE=1 python3.12 -B scripts/verify_evidence.py
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=scripts python3.12 -B scripts/test_tooling.py
```

归属：`provider=OpenCode model=opencode/deepseek-v4.1-flash-free client=opencode CLI 1.19.5`

Made via @slopdotcash
