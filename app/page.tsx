import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing-page";
export const metadata = { title: "TravelSpace — Shape the space. Guide the flow." };
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  if (view === "organizer" || view === "visitor" || view === "exhibitor")
    redirect(
      `/workspaces/main/${view === "exhibitor" ? "exhibitioner" : view}`,
    );
  return <LandingPage />;
}
