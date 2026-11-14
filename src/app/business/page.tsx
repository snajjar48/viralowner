import { redirect } from "next/navigation";

/** The old address of the profile page. */
export default function BusinessPage() {
  redirect("/profile");
}
