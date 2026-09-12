import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <div className="app-shell">
      <AppHeader />
      <main className="hub-main">
        <div className="hub-empty">
          <span className="eyebrow">PAGE NOT FOUND</span>
          <h1>This workspace or page doesn’t exist.</h1>
          <p>Return home to choose an available workspace.</p>
          <Button asChild>
            <a href="/">
              <ArrowLeft />
              Back to home
            </a>
          </Button>
        </div>
      </main>
    </div>
  );
}
