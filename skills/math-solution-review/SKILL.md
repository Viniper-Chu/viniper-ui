---
name: math-solution-review
description: 复核高中数学解答、参数分支和师生讲义中的数学结论。适用于用户要求检查推导、核对某个答案或找出错步时。
---

复核须严格遵循「**先独立盲解，后逐行对照，末附机器校验**」三步流程，严禁先顺着待审解答的思路附和：

1. **第一步：遮蔽候选结论，独立盲解与工具验算**
   - 仅从原题条件出发，独立写出定义域、等价变形的充要条件（如根式方程 $\sqrt{U}=V \iff U=V^2$ 且 $V \ge 0$；分式方程先列分母不为零）、各单调分支、像集（值域）以及每一个开闭端点与顶点（共同顶点或重根在不同实根总数中只计一次）。
   - 优先调用已注册工具取得独立证据：固定方程用 `math.quadratic.check` 的 `cases`，含水平参数的整族二次方程用 `level_family`（核对传入系数及 `lower_open` / `upper_open`，需要具体根时填入 `levels` 并代回原式检验）；关键分式、端点或选值算式用 `math.rational.evaluate` 批量精确求值。没有实际工具回执时只如实写手工验算。

2. **第二步：逐行比对候选解答，定位首个改变结论的错步**
   - 将第一步盲解得到的定义域、值域、开闭端点归属和分段计数表与待审解答逐项核对。
   - 解释临界值时，先列出实数域上的全部候选根，再逐一指明是否属于题设区间。若发现错步、漏判端点、重根重复计数、增根未舍或参数代换未用逆关系还原，明确指出最早出错的那一行、改变了哪一段结论、正确结果及理由。审阅师生讲义时分别核对教师解析与学生可见内容（严禁学生卷泄露答案或提示）。

3. **第三步：定稿末尾附机器可读校验块（供应用自动有理数抽样核对）**
   - 当题目结论属于以下三类且表达式在有理数运算范围内时，在回复最末尾附上 `math-check` 代码块（应用会自动进行精确有理数抽样与区间核验）：
     - 含参方程实根个数：`{"type":"parametric_roots","variable":"x","parameter":"a","parameter_expr":"-x^2 + 2*x","domain":{"lower":"0","upper":"3","lower_open":false,"upper_open":true},"pieces":[{"condition":"a <= -3","roots":0},{"condition":"-3 < a < 0","roots":1},{"condition":"0 <= a < 1","roots":2},{"condition":"a == 1","roots":1},{"condition":"a > 1","roots":0}]}`
     - 函数值域：`{"type":"function_range","variable":"x","expr":"-x^2 + 2*x","domain":{"lower":"0","upper":"3","lower_open":false,"upper_open":true},"range":{"lower":"-3","upper":"1","lower_open":true,"upper_open":false}}`
     - 有理/分式方程求根：`{"type":"equation_roots","variable":"x","lhs":"1/(x-1)+2","rhs":"3/(x-1)","roots":["2"]}`
