import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/rbac";
import { ROLE_HOME } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(ROLE_HOME[user.role]);
}
