import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SUBSCRIPTION_STATUSES,
  matchesSubscriptionFilter,
  SubscriptionStatusBadge,
  SubscriptionTruthUnavailable,
  type SubscriptionStatus,
} from "./subscription-truth-presentation";

test("renders every canonical subscription status, including unknown", () => {
  const statuses = Object.keys(SUBSCRIPTION_STATUSES) as SubscriptionStatus[];
  const markup = renderToStaticMarkup(
    <div>
      {statuses.map(status => <SubscriptionStatusBadge key={status} status={status} />)}
    </div>,
  );

  assert.deepEqual(statuses, [
    "paying",
    "complimentary",
    "cancellation_scheduled",
    "payment_declined",
    "churned_canceled",
    "churned_declined",
    "unknown",
  ]);
  for (const status of statuses) {
    assert.match(markup, new RegExp(SUBSCRIPTION_STATUSES[status].label.replace(/[—]/g, ".*")));
  }
});

test("unavailable state does not render a fake zero", () => {
  const markup = renderToStaticMarkup(<SubscriptionTruthUnavailable />);

  assert.match(markup, /Subscription truth is unavailable/);
  assert.match(markup, /No totals are shown/);
  assert.doesNotMatch(markup, />0</);
});

test("paying filter includes cancellation scheduled without changing exact status filters", () => {
  assert.equal(matchesSubscriptionFilter("paying", "paying_including_scheduled"), true);
  assert.equal(matchesSubscriptionFilter("cancellation_scheduled", "paying_including_scheduled"), true);
  assert.equal(matchesSubscriptionFilter("payment_declined", "paying_including_scheduled"), false);
  assert.equal(matchesSubscriptionFilter("paying", "cancellation_scheduled"), false);
  assert.equal(matchesSubscriptionFilter("cancellation_scheduled", "cancellation_scheduled"), true);
});