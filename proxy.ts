import { NextRequest, NextResponse } from "next/server";

const unauthorized = (): NextResponse => {
  return new NextResponse("認証が必要です（Tailscale経由でアクセスしてください）", { status: 401 });
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// 他のサイトから、ブラウザ経由で書き込み系のリクエスト（POSTなど）を送られていないかを確認する（CSRF対策）。
// Tailscaleの認証は、ブラウザが自動で付けるため、送り元の確認が別に必要。
const isCrossSiteWrite = (request: NextRequest): boolean => {
  if (SAFE_METHODS.has(request.method)) {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite) {
    return fetchSite !== "same-origin" && fetchSite !== "none";
  }

  // Sec-Fetch-Site を送らない古いブラウザでは、Originヘッダーで確認する（送らないcurlなどの非ブラウザは許可）
  const origin = request.headers.get("origin");

  if (!origin) {
    return false;
  }

  try {
    const originHost = new URL(origin).host;
    const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")];

    return !hosts.includes(originHost);
  } catch {
    return true;
  }
};

// tailscale serve は、tailnet内の認証済み端末からのリクエストにのみ
// Tailscale-User-Login ヘッダーを付与する（tailscaledがローカルプロキシとして
// 検証・付与するため、外部から偽装できない。ただしアプリ自体を 127.0.0.1 にのみ
// バインドし、tailscale serve 経由以外の直接アクセスを遮断していることが前提）。
export function proxy(request: NextRequest): NextResponse {
  const tailscaleLogin = request.headers.get("tailscale-user-login");

  if (!tailscaleLogin) {
    return unauthorized();
  }

  // 許可するTailscaleユーザーが未設定のときは、tailnet内の誰でも入れてしまうため、拒否する
  const allowedUser = process.env.DASHBOARD_ALLOWED_TAILSCALE_USER;
  if (!allowedUser || tailscaleLogin !== allowedUser) {
    return unauthorized();
  }

  if (isCrossSiteWrite(request)) {
    return new NextResponse("別のサイトからの書き込みリクエストは受け付けません", { status: 403 });
  }

  // JSON以外の本文（text/plain など。ブラウザが事前確認なしで送れる形式）の書き込みは受け付けない
  if (!SAFE_METHODS.has(request.method) && request.nextUrl.pathname.startsWith("/api/")) {
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().startsWith("application/json")) {
      return new NextResponse("Content-Type は application/json で送ってください", { status: 415 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.png).*)"]
};
