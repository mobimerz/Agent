import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 relative flex min-h-dvh flex-col items-center justify-center p-4">
      <div className="absolute top-3 right-3">
        <ThemeToggle />
      </div>
      <Logo className="mb-6 text-lg" />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
