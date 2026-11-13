import type { StructuredFileHost } from "../files/structured-file-tools";
import type { ToolExecutor } from "../tools/tool-registry";

/** Pure calculation, using the same bundled stdlib Python host as the desktop file tools. */
export function createQuadraticCheckTool(host: StructuredFileHost): ToolExecutor {
  return {
    name: "math.quadratic.check", readOnly: true,
    description: "精确核对指定区间内的实根个数。若可整理为二次函数等于参数，或零式的常数项含一次参数，传 level_family 一次求出全部分段的左支、右支、共同顶点及不同根数；固定数值方程传 cases。一次批量提交需要核验的方程，三种输入选其一，成功后用解析方法完成证明。先自行确保原题等价，把对未知数 x 的限制换成区间，再解释分段依据。",
    inputSchema: { type: "object", properties: {
      level_families: { type: "array", description: "同一题含多个方程或多个定义域时，把各自的 level_family 对象放在同一数组；按输入顺序返回全部分类。完整分类后进入解答阶段。" },
      level_family: { type: "object", description: "分类题优先。形如 {a,b,c,lower?,upper?,lower_open?,upper_open?}，若 a、b、c 都是有理数，按 ax²+bx+c=t 分类。也支持零式 ax²+bx+c=0，其中 c 是一个参数的一次式字符串，工具会移项并返回对应的参数分段。左支指 x 不大于对称轴，右支指 x 不小于对称轴，两支均与原定义域取交集。区间限制未知数 x，省略端点为无穷，给出时默认闭端点。" },
      cases: { type: "array", description: '每项 {a,b,c,lower?,upper?,lower_open?,upper_open?}。a、b、c 是代入某一参数值后的多项式系数。每个代表值传一项，区间由原题对未知数的限制确定。端点省略为无穷，给出时默认闭端点；有理数可传整数或分数字符串。' },
    }, additionalProperties: false },
    async execute(request, context) {
      try {
        const data = await host.execute("math.quadratic.check", request.input ?? {}, context.signal);
        return { toolId: request.id, text: JSON.stringify(data), data, isError: data.ok !== true };
      } catch (error) {
        return { toolId: request.id, text: String(error), isError: true, cancelled: context.signal.aborted };
      }
    },
  };
}
