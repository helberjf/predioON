import { Navigate, Route, Routes } from "react-router-dom";
import { LoginScreen, useAuth } from "@predioon/ui";
import { MobileShell } from "./layout/MobileShell.js";
import { Home } from "./pages/Home.js";
import { Notices } from "./pages/Notices.js";
import { Occurrences } from "./pages/Occurrences.js";
import { Reservations } from "./pages/Reservations.js";
import { Profile } from "./pages/Profile.js";

export function App() {
  const { user, loading, buildingId } = useAuth();

  if (loading) return <p className="p-8 text-slate-500">Carregando...</p>;
  if (!user) return <LoginScreen subtitle="Portal do morador" />;

  if (!buildingId) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center text-slate-600">
        Sua conta ainda não está vinculada a um condomínio. Procure a administração.
      </main>
    );
  }

  return (
    <MobileShell>
      <Routes>
        <Route path="/" element={<Home buildingId={buildingId} />} />
        <Route path="/avisos" element={<Notices buildingId={buildingId} />} />
        <Route path="/chamados" element={<Occurrences buildingId={buildingId} />} />
        <Route path="/reservas" element={<Reservations buildingId={buildingId} />} />
        <Route path="/perfil" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MobileShell>
  );
}
