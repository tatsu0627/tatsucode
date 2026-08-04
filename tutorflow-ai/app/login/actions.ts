"use server";

import { createActionDatabaseClient } from "@/lib/db/action";
import { redirect } from "next/navigation";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const db = await createActionDatabaseClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=invalid");
  redirect("/home");
}

export async function demoLogin() {
  const email = process.env.DEMO_EMAIL;
  const password = process.env.DEMO_PASSWORD;
  if (!email || !password) redirect("/login?error=demo_unavailable");

  const db = await createActionDatabaseClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=demo_unavailable");
  redirect("/home");
}

export async function logout() {
  const db = await createActionDatabaseClient();
  await db.auth.signOut();
  redirect("/login");
}
