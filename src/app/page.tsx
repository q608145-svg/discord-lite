"use client";

import { useState } from "react";
import AuthScreen from "@/components/AuthScreen";
import AppShell from "@/components/AppShell";
import type { User } from "@/lib/types";

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  return user ? <AppShell user={user} /> : <AuthScreen onAuthed={setUser} />;
}
