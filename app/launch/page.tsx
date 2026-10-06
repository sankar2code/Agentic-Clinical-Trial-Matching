'use client';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PATIENTS } from '@/lib/data';
import { useApp } from '@/lib/store';
import { Banner } from '@/components/ui';

const STEPS = ['GET /launch?iss=…&launch=… (EHR-initiated)', 'Discover .well-known/smart-configuration', 'Authorize: patient/*.read launch/patient', 'POST /callback: exchange code for token', 'Receive patient context (FHIR Patient id)'];

function Launch() {
  const q = useSearchParams();
  const router = useRouter();
  const { log, s } = useApp();
  const [n, setN] = useState(0);
  const pid = q.get('patient') ?? '';
  const p = PATIENTS.find((x) => x.id === pid);
  const done = useRef(false);
  useEffect(() => {
    if (!p) return;
    if (n < STEPS.length) { const t = setTimeout(() => setN(n + 1), 330); return () => clearTimeout(t); }
    if (done.current) return; // a launch is one audited event, even if the effect runs twice
    done.current = true;
    log('smart.launch', `SMART on FHIR launch for ${p.name}`, pid);
    router.replace(`/patient/${pid}/trials`);
  }, [n, p]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
        <h1>Launch failed</h1>
        <Banner tone="bad">The EHR did not supply a valid patient context{pid ? ` (“${pid.slice(0, 40)}”)` : ''}. Nothing was opened and nothing was logged as a launch.</Banner>
        <Link href="/">Back to the EHR schedule</Link>
      </div>
    );
  }
  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
      <h1>Launching Trial Match</h1>
      <p className="muted">Embedded app handshake with the EHR (simulated).{s.sim.ehr === 'down' ? ' EHR is set to unavailable; the panel will report it.' : ''}</p>
      <div className="col mono">
        {STEPS.map((x, i) => <div key={x} style={{ opacity: i < n ? 1 : .35 }}>{i < n ? '✓' : '·'} {x}</div>)}
      </div>
    </div>
  );
}
export default function Page() { return <Suspense><Launch /></Suspense>; }
