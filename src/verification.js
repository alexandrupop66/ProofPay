import { config } from "./config.js";

const semanticCriteria = [
  "Prominently mentions sustainability",
  "Uses a professional promotional tone",
  "Includes the exact slogan: Brew Better. Waste Less.",
  "Does not contain or promote disposable plastic cups"
];

export function decodeImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!match) {
    return { error: "Upload must be a PNG or JPG image." };
  }

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const dimensions = readDimensions(buffer, mimeType);
  return { mimeType, buffer, ...dimensions };
}

export function readDimensions(buffer, mimeType) {
  if (mimeType === "image/png") {
    const isPng = buffer.length >= 24 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPng) return { width: null, height: null, error: "PNG signature is invalid." };
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (mimeType === "image/jpeg") {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return { width: null, height: null, error: "JPG signature is invalid." };
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) return { width: null, height: null, error: "Could not read JPG dimensions." };
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }

  return { width: null, height: null, error: "Unsupported or unreadable image." };
}

export function runDeterministicChecks(submission) {
  const decoded = decodeImageDataUrl(submission?.imageDataUrl);
  const sizeBytes = decoded.buffer?.length || 0;
  const extension = (submission?.fileName || "").toLowerCase().split(".").pop();
  const supportedExtension = ["png", "jpg", "jpeg"].includes(extension);
  const dimensionsPass = Number(decoded.width) >= 800 && Number(decoded.height) >= 450;
  const sizePass = sizeBytes >= 1024 && sizeBytes <= 2 * 1024 * 1024;

  const checks = [
    {
      criterion: "PNG/JPG exists",
      status: decoded.buffer && supportedExtension && !decoded.error ? "PASS" : "FAIL",
      reasoning: decoded.error || `Received ${submission.fileName} as ${decoded.mimeType}.`,
      evidence: submission.fileName || "No file name supplied"
    },
    {
      criterion: "Minimum dimensions 800 x 450",
      status: dimensionsPass ? "PASS" : "FAIL",
      reasoning: decoded.width && decoded.height ? `Image is ${decoded.width} x ${decoded.height}.` : "Dimensions could not be read.",
      evidence: decoded.width && decoded.height ? `${decoded.width} x ${decoded.height}` : "No readable dimensions"
    },
    {
      criterion: "File size valid",
      status: sizePass ? "PASS" : "FAIL",
      reasoning: `Image size is ${Math.round(sizeBytes / 1024)} KB.`,
      evidence: `${sizeBytes} bytes`
    }
  ];

  return {
    checks,
    metadata: {
      mimeType: decoded.mimeType || null,
      width: decoded.width || null,
      height: decoded.height || null,
      sizeBytes
    },
    pass: checks.every((check) => check.status === "PASS")
  };
}

export async function runAiVerification(submission, agreement) {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured. AI verification cannot run.");
  }

  const prompt = [
    "You are ProofPay's verifier for a buyer-approved payment workflow.",
    "Decide whether the supplier's creative deliverable satisfies each semantic criterion.",
    "Return JSON only. Cite exact visual evidence, visible text, or supplier notes for every check.",
    "Use FAIL when evidence is missing, ambiguous, unprofessional, or contains the forbidden concept.",
    "Do not make payment decisions; only verify the work.",
    "",
    `Job: ${agreement.title}`,
    "Semantic criteria:",
    semanticCriteria.map((criterion) => `- ${criterion}`).join("\n"),
    "",
    "Evidence supplied by the supplier:",
    `Visible text / image description: ${submission.visibleText || "(none)"}`,
    `Supplier notes: ${submission.notes || "(none)"}`,
    `File: ${submission.fileName}`
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.openAiModel,
      temperature: 0,
      max_output_tokens: 1100,
      text: {
        format: {
          type: "json_schema",
          name: "proofpay_semantic_verification",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["overallStatus", "summary", "checks"],
            properties: {
              overallStatus: { type: "string", enum: ["PASS", "FAIL"] },
              summary: { type: "string" },
              checks: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["criterion", "status", "reasoning", "evidence"],
                  properties: {
                    criterion: { type: "string" },
                    status: { type: "string", enum: ["PASS", "FAIL"] },
                    reasoning: { type: "string" },
                    evidence: { type: "string" }
                  }
                }
              }
            }
          }
        }
      },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: submission.imageDataUrl }
          ]
        }
      ]
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OpenAI verification failed with HTTP ${response.status}: ${body.error?.message || "unknown_error"}`);
  }

  const text = body.output_text || body.output?.flatMap((item) => item.content || [])
    .find((content) => content.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI verification did not return structured text.");

  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.checks) || !["PASS", "FAIL"].includes(parsed.overallStatus)) {
    throw new Error("OpenAI verification returned invalid JSON.");
  }

  return {
    checks: parsed.checks,
    summary: parsed.summary,
    pass: parsed.overallStatus === "PASS" && parsed.checks.every((check) => check.status === "PASS")
  };
}
