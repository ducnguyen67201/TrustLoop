import { describe, expect, it } from "vitest";

/**
 * Mirror of the private extractCustomerSlackUserId helper in support-analysis.activity.ts.
 * Kept in sync manually -- if the source logic changes, update this copy.
 */

interface EventWithDetails {
  eventType: string;
  detailsJson: unknown;
}

function extractCustomerSlackUserId(events: EventWithDetails[]): string | null {
  for (const event of events) {
    if (event.eventType !== "MESSAGE_RECEIVED") continue;

    const details = event.detailsJson as Record<string, unknown> | null;
    if (!details) continue;

    if (details.authorRoleBucket !== "customer") continue;

    const slackUserId = details.slackUserId;
    if (typeof slackUserId === "string" && slackUserId.length > 0) {
      return slackUserId;
    }
  }

  return null;
}

describe("extractCustomerSlackUserId", () => {
  it("returns slackUserId from the first customer MESSAGE_RECEIVED event", () => {
    const events: EventWithDetails[] = [
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "customer",
          slackUserId: "U_CUSTOMER_1",
        },
      },
    ];

    expect(extractCustomerSlackUserId(events)).toBe("U_CUSTOMER_1");
  });

  it("returns null when no events exist", () => {
    expect(extractCustomerSlackUserId([])).toBeNull();
  });

  it("returns null when no MESSAGE_RECEIVED events exist", () => {
    const events: EventWithDetails[] = [
      {
        eventType: "ANALYSIS_COMPLETED",
        detailsJson: {
          authorRoleBucket: "customer",
          slackUserId: "U_CUSTOMER_1",
        },
      },
      {
        eventType: "STATUS_CHANGED",
        detailsJson: {
          authorRoleBucket: "customer",
          slackUserId: "U_CUSTOMER_2",
        },
      },
    ];

    expect(extractCustomerSlackUserId(events)).toBeNull();
  });

  it("returns null when detailsJson is null", () => {
    const events: EventWithDetails[] = [
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: null,
      },
    ];

    expect(extractCustomerSlackUserId(events)).toBeNull();
  });

  it("returns null when authorRoleBucket is not 'customer'", () => {
    const events: EventWithDetails[] = [
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "internal",
          slackUserId: "U_AGENT_1",
        },
      },
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "bot",
          slackUserId: "U_BOT_1",
        },
      },
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "system",
          slackUserId: "U_SYSTEM_1",
        },
      },
    ];

    expect(extractCustomerSlackUserId(events)).toBeNull();
  });

  it("returns null when slackUserId is an empty string", () => {
    const events: EventWithDetails[] = [
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "customer",
          slackUserId: "",
        },
      },
    ];

    expect(extractCustomerSlackUserId(events)).toBeNull();
  });

  it("skips non-customer events and returns the first customer slackUserId", () => {
    const events: EventWithDetails[] = [
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "internal",
          slackUserId: "U_AGENT_1",
        },
      },
      {
        eventType: "ANALYSIS_COMPLETED",
        detailsJson: {
          authorRoleBucket: "customer",
          slackUserId: "U_WRONG_TYPE",
        },
      },
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: null,
      },
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "customer",
          slackUserId: "U_FIRST_CUSTOMER",
        },
      },
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "customer",
          slackUserId: "U_SECOND_CUSTOMER",
        },
      },
    ];

    expect(extractCustomerSlackUserId(events)).toBe("U_FIRST_CUSTOMER");
  });

  it("returns null when slackUserId is missing from detailsJson", () => {
    const events: EventWithDetails[] = [
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "customer",
        },
      },
    ];

    expect(extractCustomerSlackUserId(events)).toBeNull();
  });

  it("returns null when slackUserId is a non-string type", () => {
    const events: EventWithDetails[] = [
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "customer",
          slackUserId: 12345,
        },
      },
      {
        eventType: "MESSAGE_RECEIVED",
        detailsJson: {
          authorRoleBucket: "customer",
          slackUserId: undefined,
        },
      },
    ];

    expect(extractCustomerSlackUserId(events)).toBeNull();
  });
});
