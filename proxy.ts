import { NextRequest, NextResponse } from "next/server";

const unauthorized = (): NextResponse => {
  return new NextResponse("認証が必要です（Tailscale経由でアクセスしてください）", { status: 401 });
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

  const allowedUser = process.env.DASHBOARD_ALLOWED_TAILSCALE_USER;
  if (allowedUser && tailscaleLogin !== allowedUser) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.png).*)"]
};
