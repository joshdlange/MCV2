import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { canAutoApproveCardPhoto, imageReviewDetails, validateWrongImageReason, wrongImageReasons } from "../services/cardPhotoReviewPolicy";

test("only full admins skip review, never trusted uploaders or Image Admins", () => {
  for (const trustedUploader of [false, true]) {
    assert.equal(canAutoApproveCardPhoto({ isAdmin: false, trustedUploader }), false);
    assert.equal(canAutoApproveCardPhoto({ isAdmin: true, trustedUploader }), true);
  }
  assert.equal(canAutoApproveCardPhoto({}), false);
});

test("reports carry only recognized reasons and are distinct from photo submissions", () => {
  for (const reason of wrongImageReasons) {
    assert.equal(validateWrongImageReason(reason), reason);
    assert.deepEqual(imageReviewDetails(`wrong_image:${reason}`), { reviewKind: "wrong_image", reviewReason: reason });
  }
  assert.throws(() => validateWrongImageReason("free text"));
  assert.deepEqual(imageReviewDetails("scan_to_add"), { reviewKind: "photo", reviewReason: null });
});

test("DEV recognition and Add routes must not acquire photo-persistence dependencies", () => {
  // Structural guard complements the executed client action test and real DB
  // approval tests. A regression adding uploads/queue writes here fails directly.
  for (const file of ["server/devScanRoutes.ts", "server/devScanUxRoutes.ts"]) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const forbidden = new Set(["uploadUserCardImage", "uploadImage", "createPendingCardImage", "createScanUpload", "pendingCardImages"]);
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text), `${file} cannot depend on ${node.text}`);
      if (ts.isCallExpression(node)) {
        const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.getText(source);
        assert.ok(!forbidden.has(name), `${file} must not call ${name}: ordinary scans/Add cannot persist photos`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});