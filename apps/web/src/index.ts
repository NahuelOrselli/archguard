import { getHealth } from "./lib/http";

export function renderHome(): string {
  const health = getHealth();
  return `web up: ${health}`;
}
