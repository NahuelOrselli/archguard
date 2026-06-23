import { Client } from "pg";

export function getHealth(): string {
  return `ok:${Client.name}`;
}
