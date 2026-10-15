import { readFile } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { ProviderRegistry } from "../providers/provider-registry";
import { ToolExecutor } from "../tools/tool-registry";

export function createLocalImageTool(registry: ProviderRegistry): ToolExecutor {
  return {
    name: "file.image.analyze", readOnly: true, authorizationScope: "computer",
    description: "使用当前本机视觉模型读取一张指定图片，只回答 prompt 中的问题；不加载另一个模型。不清晰处须说明。",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "PNG/JPEG/WebP 的绝对路径。" }, prompt: { type: "string", description: "需要读取的具体内容或问题。" } }, required: ["path", "prompt"], additionalProperties: false },
    async execute(request, context) {
      try {
        const path = String(request.input?.path ?? "");
        const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" } as Record<string, string>)[extname(path).toLowerCase()];
        if (!isAbsolute(path) || !mime) throw new Error("请提供 PNG/JPEG/WebP 图片的绝对路径。");
        const snapshot = context.providerSnapshot;
        if (!snapshot) throw new Error("缺少本轮模型连接。");
        const provider = registry.get(snapshot.providerId);
        if (!provider.runtimePolicyFor?.(snapshot.modelId)?.visionEnabled || !provider.analyzeImage) throw new Error("当前模型连接未声明本机图像能力。");
        const bytes = await readFile(path);
        if (bytes.length > 8 * 1024 * 1024) throw new Error("图片超过 8 MiB，请先缩小图片。");
        const result = await provider.analyzeImage({ model: snapshot.modelId, image: `data:${mime};base64,${bytes.toString("base64")}`, prompt: String(request.input?.prompt), reasoning: snapshot.reasoning }, context.signal, context.onProviderActivity);
        const data = { ok: true, path, ...result };
        return { toolId: request.id, text: JSON.stringify(data), data, displayText: result.text, providerUsage: result.usage };
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        return { toolId: request.id, text: JSON.stringify({ ok: false, error: text }), displayText: text, isError: true, cancelled: context.signal.aborted };
      }
    },
  };
}
