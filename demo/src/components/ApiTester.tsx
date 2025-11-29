interface ApiTesterProps {
  onApiCall: (endpoint: string) => void;
  loading: boolean;
}

const API_BUTTONS = [
  { label: "Get Users", endpoint: "/users" },
  { label: "Get User #1", endpoint: "/users/1" },
  { label: "Get Posts", endpoint: "/posts" },
  { label: "Get Post #1", endpoint: "/posts/1" },
  { label: "Get Comments", endpoint: "/comments?postId=1" },
  { label: "Get Todos", endpoint: "/todos" },
];

export function ApiTester({ onApiCall, loading }: ApiTesterProps) {
  return (
    <div className="btn-group">
      {API_BUTTONS.map((btn) => (
        <button
          type="button"
          key={btn.endpoint}
          className="btn btn-primary"
          onClick={() => onApiCall(btn.endpoint)}
          disabled={loading}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}
