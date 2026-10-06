'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { FACT_LABEL } from '@/lib/data';
import { HANDOUT_LANGUAGES, buildBrief, buildHandout, handoutApproved, handoutHash, handoutText, isSupportedLang, readingGrade } from '@/lib/brief';
import { effectiveFacts, matchAll, undismissed } from '@/lib/engine';
import { plansFor, rankActions } from '@/lib/path';
import { PERM_HINT, useApp } from '@/lib/store';
import { Banner, StateChip } from '@/components/ui';

export default function Brief() {
  const { id } = useParams<{ id: string }>();
  const { s, trials, patient, mctx, can, setHandout, versionStamp, actor, shadowHidden, searchedFor } = useApp();
  const p = patient(id);
  const [tab, setTab] = useState<'brief' | 'handout'>('brief');
  const [tid, setTid] = useState('');
  const [lang, setLang] = useState('');
  // A trial the clinician dismissed is not recommended, briefed or handed out.
  const matches = useMemo(() => (p?.treating ? undismissed(matchAll(p, trials, mctx()), s.dismissals, p.id) : []), [p, trials, s.overlay, s.overrides, s.queryDate, s.sim.regression, s.dismissals]); // eslint-disable-line react-hooks/exhaustive-deps
  const candidates = matches.filter((m) => m.state === 'eligible' || m.state === 'near');

  if (!p) return <Banner tone="bad">Unknown patient.</Banner>;
  if (!p.treating) return <Banner tone="bad"><b>Access restricted.</b> No treating relationship with this patient.</Banner>;
  if (shadowHidden) return <Banner tone="rev"><b>Shadow mode.</b> The brief is built from the system’s results, which are hidden from clinicians and coordinators in this mode.</Banner>;

  const ranked = rankActions(plansFor(matches.filter((m) => m.state !== 'filtered'), p, searchedFor(p.id)));
  const brief = buildBrief(p, effectiveFacts(p, s.overlay), matches, ranked, s.queryDate, versionStamp);
  const chosen = candidates.find((m) => m.trial.id === (tid || candidates[0]?.trial.id));
  const wanted = lang || (isSupportedLang(p.language) ? p.language : p.language);
  const handout = chosen ? buildHandout(p, chosen, wanted) : null;
  const key = chosen && handout ? `${p.id}|${chosen.trial.id}|${handout.lang}` : '';
  const rec = key ? s.handouts[key] : undefined;
  // An approval covers the exact text that was approved. If the state moves (near to eligible) the wording changes, and the old approval no longer applies.
  const text = handout ? handoutText(handout) : '';
  const textHash = handoutHash(text);
  const approved = !!handout && handoutApproved(rec, text);
  const outdated = rec?.status === 'approved' && !approved;
  const grade = handout && handout.lang === 'English' ? readingGrade(handoutText(handout)) : null;

  return (
    <div>
      <p className="small noprint"><Link href={`/patient/${id}/trials`}>← {p.name}</Link></p>
      <div className="row between wrap noprint">
        <h1>{p.name}: visit brief</h1>
        {tab === 'brief' && <button className="btn sm" onClick={() => window.print()}>Print the brief</button>}
      </div>
      <div className="tabs noprint" role="tablist">
        <button role="tab" aria-selected={tab === 'brief'} className={tab === 'brief' ? 'on' : ''} onClick={() => setTab('brief')}>For the oncologist</button>
        <button role="tab" aria-selected={tab === 'handout'} className={tab === 'handout' ? 'on' : ''} onClick={() => setTab('handout')}>Patient handout</button>
      </div>

      {tab === 'brief' && (
        <div className="paper">
          <div className="row between"><h1 style={{ margin: 0 }}>Trial brief</h1><span className="chip gray">~{brief.minutes} min read · {brief.words} words</span></div>
          <p style={{ marginTop: 8 }}><b>{brief.patientLine}</b></p>
          {brief.recommendation ? (
            <>
              <h2>Best match: {brief.recommendation.trial.code} <StateChip s={brief.recommendation.state} /></h2>
              <p className="muted">{brief.recommendation.trial.title}</p>
              {brief.recommendation.why.length > 0 && <><b>Why it fits</b><ul>{brief.recommendation.why.map((w) => <li key={w}>{w}</li>)}</ul></>}
              {brief.recommendation.open.length > 0 && <><b>Still to confirm</b><ul>{brief.recommendation.open.map((w) => <li key={w}>{w}</li>)}</ul></>}
            </>
          ) : (
            <>
              <h2>No trial to recommend</h2>
              <p>{brief.closest ?? 'No trial passed the pre-filter for this patient.'}</p>
            </>
          )}
          {brief.watchouts.length > 0 && <><h2>Watch-outs</h2><ul>{brief.watchouts.map((w) => <li key={w}>{w}</li>)}</ul></>}
          {brief.others.length > 0 && <><h2>Other options</h2><ul>{brief.others.map((w) => <li key={w}>{w}</li>)}</ul></>}
          {brief.nextAction && <><h2>If you do one thing</h2><p>{brief.nextAction}</p></>}
          <p className="muted small" style={{ marginTop: 18 }}>Built only from the matching engine’s results and the chart; no model wrote any sentence of it. As of {brief.asOf} · {brief.stamp}. A screening aid: formal eligibility is confirmed by the trial team per protocol.</p>
        </div>
      )}

      {tab === 'handout' && (
        candidates.length === 0 ? <div className="card muted">There is no likely or near-eligible trial for this patient, so there is nothing to hand out.</div> : (
          <>
            <div className="card noprint" style={{ marginBottom: 12 }}>
              <div className="row wrap" style={{ alignItems: 'flex-end' }}>
                <div style={{ width: 230 }}><label htmlFor="trial">Study</label><select id="trial" value={chosen?.trial.id} onChange={(e) => setTid(e.target.value)}>{candidates.map((m) => <option key={m.trial.id} value={m.trial.id}>{m.trial.code} ({m.state === 'eligible' ? 'likely eligible' : 'near-eligible'})</option>)}</select></div>
                <div style={{ width: 200 }}><label htmlFor="lang">Language</label><select id="lang" value={wanted} onChange={(e) => setLang(e.target.value)}>{Array.from(new Set([...HANDOUT_LANGUAGES, p.language])).map((l) => <option key={l} value={l}>{l}{l === p.language ? ' (patient’s language)' : ''}</option>)}</select></div>
                <span className={`chip ${approved ? 'met' : 'unknown'}`}>{approved ? `Approved by ${rec?.by}` : outdated ? 'Approval out of date: the text changed' : 'Draft: not yet approved for sharing'}</span>
                {grade !== null && <span className={`chip ${grade <= 8 ? 'met' : 'unknown'}`}>Reading grade {grade}</span>}
              </div>
              {handout?.fallback && <Banner tone="warn"><b>No translation available for {p.language}.</b> English is shown. An interpreter is required before this is shared.</Banner>}
              {handout?.needsInterpreter && (
                <label className="row" style={{ margin: '8px 0 0', fontWeight: 400, color: 'var(--ink)' }}>
                  <input type="checkbox" style={{ width: 'auto' }} disabled={!can('handout') || approved} checked={!!rec?.interpreterReviewed} onChange={(e) => setHandout(key, { interpreterReviewed: e.target.checked })} />
                  A qualified medical interpreter has reviewed this {handout.lang} text (machine-assisted translation).
                </label>
              )}
              <div className="row wrap" style={{ marginTop: 10 }}>
                <button className="btn pri" disabled={!can('handout') || approved || !handout || (handout.needsInterpreter && !rec?.interpreterReviewed)} title={!can('handout') ? PERM_HINT.handout : handout?.needsInterpreter && !rec?.interpreterReviewed ? 'An interpreter must review a non-English handout first' : ''}
                  onClick={() => setHandout(key, { status: 'approved', by: actor, at: new Date().toISOString(), hash: textHash }, `Handout for ${chosen!.trial.code} in ${handout!.lang} approved for sharing${handout!.needsInterpreter ? ' after interpreter review' : ''}`, p.id, chosen!.trial.id)}>Approve for sharing</button>
                <button className="btn" disabled={(!approved && !outdated) || !can('handout')} onClick={() => setHandout(key, { status: 'draft', by: undefined, at: undefined, hash: undefined }, `Handout for ${chosen!.trial.code} in ${handout!.lang} returned to draft`, p.id, chosen!.trial.id)}>Return to draft</button>
                <button className="btn" disabled={!approved} title={approved ? '' : 'Approve it first'} onClick={() => window.print()}>Print handout</button>
              </div>
              <p className="muted small" style={{ margin: '8px 0 0' }}>The handout contains no clinical values and no promise of eligibility. A clinician approves it before it is shared, and the approval is logged.</p>
            </div>
            {handout && (
              <div className="paper">
                {!approved && <p className="printonly draftmark">DRAFT: NOT APPROVED FOR SHARING</p>}
                {!approved && <p className="small noprint" style={{ color: '#a33' }}>{outdated ? 'This text changed after it was approved (the trial moved between likely and near-eligible). Approve it again before sharing.' : 'Draft preview. Not approved for sharing.'}</p>}
                <h1>{handout.title}</h1>
                {handout.sections.map((sec, i) => <div key={i}>{sec.heading && <h2>{sec.heading}</h2>}<p>{sec.text}</p></div>)}
                <h2>{handout.asksTitle}</h2>
                <ol>{handout.asks.map((a) => <li key={a}>{a}</li>)}</ol>
                <p className="muted small" style={{ marginTop: 16 }}>{handout.footer}</p>
              </div>
            )}
            <p className="muted small noprint" style={{ marginTop: 8 }}>Facts from your chart behind this page: {chosen ? chosen.results.filter((r) => r.status === 'met').slice(0, 3).map((r) => FACT_LABEL[r.criterion.rule.fact]).join(', ') : ''}. These are not printed on the handout.</p>
          </>
        )
      )}
    </div>
  );
}
