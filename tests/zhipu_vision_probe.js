// 智谱免费视觉模型 (GLM-4V-Flash) 探针：验证两件事
//  1) base64 截图能否通过 OpenAI 兼容端点被接受（mio 的 capture() 输出 data URL）
//  2) 视觉模型能否返回目标的像素坐标（视觉坐标点击方案的根基）
// 零第三方依赖：内置极简 PNG 编码器（zlib 是标准库），Node 22 原生 fetch。
//
// 用法（PowerShell）：
//   $env:ZHIPU_API_KEY="<你的key>"
//   node tests/zhipu_vision_probe.js                    # 内置测试图
//   node tests/zhipu_vision_probe.js --image shot.png   # 用自己的截图
//   node tests/zhipu_vision_probe.js --model glm-4.6v-flash
//
// 通过标准：HTTP 200 且坐标命中内置按钮中心 (650,200) ± 40px。
// 若 data 前缀变体失败而裸 base64 成功，说明需去掉 data: 前缀。

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const DEFAULT_MODELS = ["glm-4v-flash", "glm-4.6v-flash"];
const BUTTON_CX = 650;
const BUTTON_CY = 200;
const TOLERANCE = 40;

// ── 极简 PNG 编码器 ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, rowStart + 1);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// 画一张 800x400 测试图：左侧输入框 + 右侧蓝色圆形发送按钮（中心 650,200）。
function drawTestImage() {
  const W = 800, H = 400;
  const px = new Uint8Array(W * H * 3);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  };
  const fillRect = (x0, y0, x1, y1, r, g, b) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, r, g, b);
  };
  const circle = (cx, cy, rad, r, g, b) => {
    for (let y = cy - rad; y <= cy + rad; y++) {
      for (let x = cx - rad; x <= cx + rad; x++) {
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d <= rad * rad) set(x, y, r, g, b);
      }
    }
  };
  // 背景
  fillRect(0, 0, W - 1, H - 1, 245, 245, 247);
  // 输入框（白底黑边）
  fillRect(50, 170, 600, 230, 255, 255, 255);
  fillRect(50, 170, 600, 172, 0, 0, 0);
  fillRect(50, 228, 600, 230, 0, 0, 0);
  fillRect(50, 170, 52, 230, 0, 0, 0);
  fillRect(598, 170, 600, 230, 0, 0, 0);
  // 输入框占位文字（灰色条）
  fillRect(70, 195, 300, 205, 200, 200, 200);
  // 发送按钮（蓝色圆形 + 白色箭头）
  circle(BUTTON_CX, BUTTON_CY, 30, 0, 122, 255);
  for (let dy = -8; dy <= 8; dy++) {
    const half = 10 - Math.abs(dy) * 0.4;
    for (let dx = -half; dx <= half; dx++) set(BUTTON_CX + dx + 4, BUTTON_CY + dy, 255, 255, 255);
  }
  return encodePNG(W, H, px);
}

// ── 参数解析 ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { models: DEFAULT_MODELS.slice(), image: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--image" && argv[i + 1]) out.image = argv[i + 1];
    if (a === "--model" && argv[i + 1]) out.models = [argv[i + 1]];
    if (a === "--key" && argv[i + 1]) out.key = argv[i + 1];
    if (a === "--write-test-png" && argv[i + 1]) out.writeTestPng = argv[i + 1];
    if (a === "--help") out.help = true;
  }
  return out;
}

// ── 探针 ─────────────────────────────────────────────────────────
function extractXY(text) {
  const m = (text || "").match(/(\d+)\s*[,，]\s*(\d+)/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

async function probe({ key, model, url, prompt }) {
  const body = {
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url } },
      ],
    }],
    temperature: 0.1,
    max_tokens: 200,
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let answer = text;
  try {
    const json = JSON.parse(text);
    answer = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || JSON.stringify(json).slice(0, 300);
  } catch (_) {}
  return { status: res.status, answer };
}

async function runCase({ key, model, b64, label, prompt, wantCoord }) {
  const variants = [
    { name: "data-url", url: "data:image/png;base64," + b64 },
    { name: "bare-b64", url: b64 },
  ];
  for (const v of variants) {
    const { status, answer } = await probe({ key, model, url: v.url, prompt });
    const xy = wantCoord ? extractXY(answer) : null;
    let verdict;
    if (status !== 200) {
      verdict = "FAIL(HTTP " + status + ")";
    } else if (wantCoord && xy) {
      const dist = Math.hypot(xy.x - BUTTON_CX, xy.y - BUTTON_CY);
      verdict = dist <= TOLERANCE
        ? "PASS coord(" + xy.x + "," + xy.y + ")"
        : "FAIL coord off by " + Math.round(dist) + "px -> " + xy.x + "," + xy.y;
    } else if (wantCoord) {
      verdict = "FAIL(no coord parsed)";
    } else {
      verdict = "PASS(http ok)";
    }
    console.log(`  [${v.name}] ${model} ${label}: ${verdict}`);
    if (status !== 200) {
      console.log(`    error: ${answer.slice(0, 300)}`);
    } else if (answer) {
      console.log(`    answer: ${answer.replace(/\s+/g, " ").slice(0, 160)}`);
    }
  }
}

// ── main ──────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法:");
    console.log("  $env:ZHIPU_API_KEY=\"<key>\"  （或 --key <key>）");
    console.log("  node tests/zhipu_vision_probe.js");
    console.log("    --image <png>        用自己的截图（推荐：深色/图标按钮页面）");
    console.log("    --model <id>         指定模型，默认先测 glm-4v-flash 再测 glm-4.6v-flash");
    console.log("    --key <key>          直接传 key（不设环境变量时）");
    return;
  }

  const key = args.key || process.env.ZHIPU_API_KEY;
  if (!key) {
    console.error("缺少 API Key：设置 $env:ZHIPU_API_KEY 或传 --key <key>");
    process.exit(1);
  }

  let b64;
  if (args.image) {
    const p = path.resolve(args.image);
    if (!fs.existsSync(p)) { console.error("图片不存在: " + p); process.exit(1); }
    const buf = fs.readFileSync(p);
    b64 = buf.toString("base64");
    console.log("使用截图: " + p + " (" + buf.length + " bytes)");
  } else {
    const imgBuf = drawTestImage();
    if (args.writeTestPng) {
      fs.writeFileSync(args.writeTestPng, imgBuf);
      console.log("测试图已写入: " + args.writeTestPng);
    }
    b64 = imgBuf.toString("base64");
    console.log("使用内置测试图: 800x400，输入框 + 蓝色圆形按钮(中心 650,200)");
  }

  const promptWithCoord =
    "图中输入框右侧有一个圆形发送按钮。请给出该按钮中心的大致像素坐标，" +
    "格式为两个数字 x,y（例如 650,200）。不要输出其他内容。";

  console.log("端点: " + ENDPOINT);
  console.log("── base64 支持 + 坐标精度测试 ──");
  for (const model of args.models) {
    console.log("模型: " + model);
    await runCase({ key, model, b64, label: "base64", prompt: promptWithCoord, wantCoord: true });
  }
  console.log("完成。");
}

main().catch((e) => {
  console.error("探针异常:", (e && e.message) || e);
  process.exit(1);
});
