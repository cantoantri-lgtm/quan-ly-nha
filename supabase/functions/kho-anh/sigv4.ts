// Ký link tạm (presigned URL) kiểu AWS Signature V4 cho Cloudflare R2 (chuẩn S3). Chỉ dùng Web Crypto, không thư viện ngoài.
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256hex = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

export type PresignOpts = {
  method: "GET" | "PUT" | "DELETE";
  host: string;                        // VD <account>.r2.cloudflarestorage.com
  path: string;                        // đường dẫn đã mã hoá, bắt đầu bằng "/", VD /bucket/anh-phong/<toà>/<tệp>.jpg
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;                     // R2 dùng "auto"
  service?: string;                    // "s3"
  expires: number;                     // giây
  signedHeaders?: Record<string, string>;  // ngoài host; tên chữ thường. Client PHẢI gửi đúng các header này
  now?: Date;
};

export async function presign(o: PresignOpts): Promise<string> {
  const region = o.region ?? "auto", service = o.service ?? "s3";
  const now = o.now ?? new Date();
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, "");   // 20130524T000000Z
  const date = amz.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const headers: Record<string, string> = { host: o.host, ...(o.signedHeaders ?? {}) };
  const names = Object.keys(headers).sort();
  const signedHeaderStr = names.join(";");
  const q: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${o.accessKeyId}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(o.expires),
    "X-Amz-SignedHeaders": signedHeaderStr,
  };
  const canonQuery = Object.keys(q).sort().map((k) => `${rfc3986(k)}=${rfc3986(q[k])}`).join("&");
  const canonHeaders = names.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const canonical = [o.method, o.path, canonQuery, canonHeaders, signedHeaderStr, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amz, scope, await sha256hex(canonical)].join("\n");
  const kDate = await hmac(enc.encode("AWS4" + o.secretAccessKey), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));
  return `https://${o.host}${o.path}?${canonQuery}&X-Amz-Signature=${signature}`;
}

/** Mã hoá từng đoạn của khoá tệp (giữ dấu "/") */
export const encodeKey = (key: string) => key.split("/").map(rfc3986).join("/");
