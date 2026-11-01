import { redirect } from "next/navigation";

// The diagram board belongs inside Lumi in the existing learning room.
// Keep the previously shared preview URL useful without a separate experience.
export default function DiagramPage() {
  redirect("/");
}
