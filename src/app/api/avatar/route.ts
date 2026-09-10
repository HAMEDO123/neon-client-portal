import sharp from "sharp";
import { avatarSvg } from "@/lib/avatar";

// The picture on a chat notification: the sender's initials on their colour.
//
// Public on purpose. The phone fetches it at the moment it draws the
// notification, with no session attached, and all it can reveal is two
// letters and a colour.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, 60) || "?";
  const color = url.searchParams.get("color");

  const png = await sharp(Buffer.from(avatarSvg(name, color))).png().toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // The same name and colour always draw the same picture.
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
