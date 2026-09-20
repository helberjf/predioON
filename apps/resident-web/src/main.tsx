import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertTriangle, Building2, Cpu } from "lucide-react";
import { Card } from "./components/Card";
import { getJson } from "./lib/api";
import "./index.css";

type Device = { id:string; name:string; type:string; buildingId:string; enabled:boolean };
type Alert = { id:string; message:string; severity:string; deviceId:string; createdAt:string };

function App(){
  const [devices,setDevices]=useState<Device[]>([]);
  const [alerts,setAlerts]=useState<Alert[]>([]);
  const [status,setStatus]=useState("Carregando...");
  async function load(){
    try {
      const [d,a]=await Promise.all([getJson<Device[]>("/devices"),getJson<Alert[]>("/alerts")]);
      setDevices(d); setAlerts(a); setStatus("Online");
    } catch(e){ setStatus(e instanceof Error ? e.message : "Erro"); }
  }
  useEffect(()=>{ void load(); const timer=window.setInterval(()=>void load(),10000); return ()=>window.clearInterval(timer); },[]);
  return <main className="min-h-screen">
    <header className="border-b border-slate-800 bg-slate-950/90 px-6 py-5">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div><p className="text-xs uppercase tracking-[0.25em] text-cyan-400">Prédio ON</p><h1 className="text-2xl font-bold">Portal do Morador</h1></div>
        <span className="rounded-full border border-emerald-700/40 bg-emerald-950 px-3 py-1 text-sm text-emerald-300">{status}</span>
      </div>
    </header>
    <div className="mx-auto grid max-w-7xl gap-5 p-6 lg:grid-cols-4">
      <Card title="Dispositivos"><div className="flex items-center gap-3 text-3xl font-bold"><Cpu className="text-cyan-400"/> {devices.length}</div></Card>
      <Card title="Alertas"><div className="flex items-center gap-3 text-3xl font-bold"><AlertTriangle className="text-amber-400"/> {alerts.length}</div></Card>
      <Card title="Condomínio"><div className="flex items-center gap-3 text-lg font-semibold"><Building2 className="text-indigo-400"/> bld_001</div></Card>
      <Card title="Telemetria"><div className="flex items-center gap-3 text-lg font-semibold"><Activity className="text-emerald-400"/> MQTT + Timescale</div></Card>
    </div>
    <div className="mx-auto grid max-w-7xl gap-5 px-6 pb-10 lg:grid-cols-2">
      <Card title="Dispositivos cadastrados"><div className="space-y-3">{devices.map(d=><div key={d.id} className="flex items-center justify-between rounded-xl bg-slate-950 p-3"><div><p className="font-medium">{d.name}</p><p className="text-xs text-slate-400">{d.type} · {d.id}</p></div><span className="text-xs text-emerald-400">ATIVO</span></div>)}</div></Card>
      <Card title="Alertas recentes"><div className="space-y-3">{alerts.length===0?<p className="text-slate-400">Nenhum alerta ativo.</p>:alerts.map(a=><div key={a.id} className="rounded-xl border border-amber-900/40 bg-amber-950/30 p-3"><p>{a.message}</p><p className="text-xs text-slate-400">{a.deviceId} · {a.severity}</p></div>)}</div></Card>
    </div>
  </main>
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
