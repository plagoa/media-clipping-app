import { mediaHandler } from "../server/media.js";

export default function media(req, res) {
  return mediaHandler(req, res, () => res.writeHead(404).end());
}
