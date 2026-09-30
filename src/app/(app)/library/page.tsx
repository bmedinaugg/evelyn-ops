import { redirect } from "next/navigation";

// The case library became /cases: the same rows, plus the place to propose a
// change to one. Old links keep working.
export default function LibraryRedirect() {
  redirect("/cases");
}
