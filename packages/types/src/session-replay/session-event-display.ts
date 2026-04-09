import {
  SESSION_EVENT_TYPE,
  type SessionEventType,
} from "@shared/types/session-replay/session-event.schema";

interface EventTypeDisplay {
  label: string;
  className: string;
}

const EVENT_TYPE_DISPLAY: Record<SessionEventType, EventTypeDisplay> = {
  [SESSION_EVENT_TYPE.click]: { label: "CLICK", className: "text-muted-foreground" },
  [SESSION_EVENT_TYPE.route]: { label: "ROUTE", className: "text-blue-600" },
  [SESSION_EVENT_TYPE.networkError]: { label: "NET ERR", className: "text-destructive" },
  [SESSION_EVENT_TYPE.consoleError]: { label: "CONSOLE", className: "text-orange-600" },
  [SESSION_EVENT_TYPE.exception]: { label: "ERROR", className: "text-destructive font-medium" },
};

export function sessionEventTypeDisplay(type: string): EventTypeDisplay {
  return (
    EVENT_TYPE_DISPLAY[type as SessionEventType] ?? {
      label: type,
      className: "text-muted-foreground",
    }
  );
}

export function sessionEventDescription(
  eventType: string,
  payload: Record<string, unknown>,
  url: string | null
): string {
  switch (eventType) {
    case SESSION_EVENT_TYPE.click: {
      const text = typeof payload.text === "string" ? payload.text : "";
      const tag = typeof payload.tag === "string" ? payload.tag : "element";
      return text ? `Click "${text.slice(0, 40)}"` : `Click <${tag}>`;
    }
    case SESSION_EVENT_TYPE.route: {
      const to = typeof payload.to === "string" ? payload.to : (url ?? "");
      return to;
    }
    case SESSION_EVENT_TYPE.networkError: {
      const method = typeof payload.method === "string" ? payload.method : "GET";
      const reqUrl = typeof payload.url === "string" ? payload.url : "";
      const status = typeof payload.status === "number" ? payload.status : 0;
      const path = reqUrl.replace(/^https?:\/\/[^/]+/, "");
      return `${method} ${path.slice(0, 40)} → ${status}`;
    }
    case SESSION_EVENT_TYPE.consoleError: {
      const message = typeof payload.message === "string" ? payload.message : "";
      return message.slice(0, 60);
    }
    case SESSION_EVENT_TYPE.exception: {
      const message = typeof payload.message === "string" ? payload.message : "";
      return message.slice(0, 60);
    }
    default:
      return eventType;
  }
}
