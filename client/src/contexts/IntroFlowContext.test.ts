import { test } from "node:test";
import assert from "node:assert/strict";

import {
  areIntroFlowsComplete,
  resolveIntroFlowState,
} from "./IntroFlowContext";

test("a dialog skipped for this session is complete even if it may return later", () => {
  const afterFirstSkip = resolveIntroFlowState({
    enabled: true,
    ready: true,
    open: false,
  });

  assert.equal(afterFirstSkip, "complete");
  assert.equal(areIntroFlowsComplete(afterFirstSkip, "complete"), true);
});

test("the milestone stays blocked while an intro flow is loading or open", () => {
  assert.equal(areIntroFlowsComplete("checking", "complete"), false);
  assert.equal(areIntroFlowsComplete("complete", "open"), false);
});