import { AuthForm } from "../../components/auth-form";

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e8f5ee_0%,_#f3f7f4_55%,_#dff0e6_100%)] pt-28 pb-16">
      <div className="mx-auto flex max-w-6xl justify-center px-6">
        <AuthForm />
      </div>
    </main>
  );
}
