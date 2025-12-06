export type Scenario = {
  id: string;
  title: string;
  icon: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  category: "basic" | "pathParam" | "queryString" | "nested";
  paramType?: "path" | "query";
  paramName?: string;
  paramOptions?: { value: string; label: string }[];
};

export const scenarios: Scenario[] = [
  // Basic scenarios
  {
    id: "users-list",
    title: "Users",
    icon: "users",
    description: "GET /users",
    endpoint: "/users",
    method: "GET",
    category: "basic",
  },
  {
    id: "posts-list",
    title: "Posts",
    icon: "posts",
    description: "GET /posts",
    endpoint: "/posts",
    method: "GET",
    category: "basic",
  },
  {
    id: "comments-list",
    title: "Comments",
    icon: "comments",
    description: "GET /comments",
    endpoint: "/comments",
    method: "GET",
    category: "basic",
  },

  // Path parameter scenarios
  {
    id: "user-by-id",
    title: "User by ID",
    icon: "user",
    description: "/users/:id",
    endpoint: "/users/{id}",
    method: "GET",
    category: "pathParam",
    paramType: "path",
    paramName: "id",
    paramOptions: [
      { value: "1", label: "User 1" },
      { value: "2", label: "User 2" },
      { value: "3", label: "User 3" },
      { value: "5", label: "User 5" },
      { value: "10", label: "User 10" },
    ],
  },
  {
    id: "post-by-id",
    title: "Post by ID",
    icon: "post",
    description: "/posts/:id",
    endpoint: "/posts/{id}",
    method: "GET",
    category: "pathParam",
    paramType: "path",
    paramName: "id",
    paramOptions: [
      { value: "1", label: "Post 1" },
      { value: "2", label: "Post 2" },
      { value: "3", label: "Post 3" },
    ],
  },

  // Query string scenarios
  {
    id: "posts-by-user",
    title: "Posts by User",
    icon: "filter",
    description: "/posts?userId=",
    endpoint: "/posts",
    method: "GET",
    category: "queryString",
    paramType: "query",
    paramName: "userId",
    paramOptions: [
      { value: "1", label: "User 1" },
      { value: "2", label: "User 2" },
      { value: "3", label: "User 3" },
    ],
  },
  {
    id: "comments-by-post",
    title: "Comments by Post",
    icon: "filter",
    description: "/comments?postId=",
    endpoint: "/comments",
    method: "GET",
    category: "queryString",
    paramType: "query",
    paramName: "postId",
    paramOptions: [
      { value: "1", label: "Post 1" },
      { value: "2", label: "Post 2" },
      { value: "3", label: "Post 3" },
    ],
  },

  // Nested resource scenarios
  {
    id: "post-comments",
    title: "Post Comments",
    icon: "nested",
    description: "/posts/:id/comments",
    endpoint: "/posts/{id}/comments",
    method: "GET",
    category: "nested",
    paramType: "path",
    paramName: "id",
    paramOptions: [
      { value: "1", label: "Post 1" },
      { value: "2", label: "Post 2" },
      { value: "3", label: "Post 3" },
    ],
  },
];

export const categoryLabels: Record<Scenario["category"], string> = {
  basic: "Basic",
  pathParam: "Path Parameter",
  queryString: "Query String",
  nested: "Nested Resource",
};

export function buildUrl(scenario: Scenario, paramValue?: string): string {
  let url = scenario.endpoint;

  if (paramValue) {
    if (scenario.paramType === "path") {
      url = url.replace(`{${scenario.paramName}}`, paramValue);
    } else if (scenario.paramType === "query") {
      url = `${url}?${scenario.paramName}=${paramValue}`;
    }
  }

  return url;
}
