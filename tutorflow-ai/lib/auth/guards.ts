import "server-only";

import { redirect } from "next/navigation";
import { getCurrentProfile } from "./session";

export async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}
