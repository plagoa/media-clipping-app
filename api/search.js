import { searchHandler } from "../server/search.js";

export default function search(req, res) {
  return searchHandler(req, res, () => res.writeHead(404).end());
}
