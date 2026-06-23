import { queryUsers } from "./users";

export async function getUsers(): Promise<unknown[]> {
  return queryUsers();
}
