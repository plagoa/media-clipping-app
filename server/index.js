import express from "express";
import { searchHandler } from "./search.js";
import { mediaHandler } from "./media.js";

const app = express();
app.use(searchHandler);
app.use(mediaHandler);
app.use(express.static("dist"));
app.listen(process.env.PORT || 3000, () => {
  console.log(
    `Media clipping app listening on port ${process.env.PORT || 3000}`,
  );
});
