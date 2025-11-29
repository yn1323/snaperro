const STEPS = [
  {
    title: "Proxy モードで確認",
    description: "モードが Proxy の状態で API を叩くと、実際の JSON Placeholder API からデータを取得します。",
  },
  {
    title: "Record モードで録画",
    description:
      "GUI でパターンを作成し、モードを Record に切り替えて API を叩くと、レスポンスが JSON ファイルとして保存されます。",
  },
  {
    title: "Mock モードで再生",
    description:
      "モードを Mock に切り替えると、保存された JSON ファイルが返されます（実際の API にはアクセスしません）。",
  },
  {
    title: "連番の確認",
    description:
      "同じ API を複数回叩くと、GET_1.json, GET_2.json... と連番で保存されます。Mock モードでも順番に返されます。",
  },
  {
    title: "パターン切替",
    description: "複数のパターンを作成し、GUI で切り替えることで、異なるモックデータを使い分けられます。",
  },
];

export function Tutorial() {
  return (
    <section className="section">
      <h2>Tutorial</h2>
      <ol className="tutorial-steps">
        {STEPS.map((step, index) => (
          <li key={step.title} className="tutorial-step">
            <div className="tutorial-step-number">{index + 1}</div>
            <div className="tutorial-step-content">
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
