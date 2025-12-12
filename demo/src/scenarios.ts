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
  requestBody?: unknown;
  requestBodyOptions?: { value: string; label: string; body: unknown }[];
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
  {
    id: "create-user",
    title: "Create User",
    icon: "user",
    description: "POST /users",
    endpoint: "/users",
    method: "POST",
    category: "basic",
    requestBodyOptions: [
      {
        value: "user-alice",
        label: "Alice",
        body: {
          name: "Alice",
          username: "alice",
          email: "alice@example.com",
          phone: "111-111-1111",
          website: "alice.com",
        },
      },
      {
        value: "user-bob",
        label: "Bob",
        body: {
          name: "Bob",
          username: "bob",
          email: "bob@example.com",
          phone: "222-222-2222",
          website: "bob.com",
        },
      },
      {
        value: "user-charlie",
        label: "Charlie",
        body: {
          name: "Charlie",
          username: "charlie",
          email: "charlie@example.com",
          phone: "333-333-3333",
          website: "charlie.com",
        },
      },
    ],
  },
  {
    id: "create-post",
    title: "Create Post",
    icon: "post",
    description: "POST /posts",
    endpoint: "/posts",
    method: "POST",
    category: "basic",
    requestBodyOptions: [
      {
        value: "post-user1-tech",
        label: "User1: Tech Post",
        body: {
          userId: 1,
          title: "Introduction to TypeScript",
          body: "TypeScript is a strongly typed programming language...",
        },
      },
      {
        value: "post-user1-travel",
        label: "User1: Travel Post",
        body: {
          userId: 1,
          title: "My Trip to Japan",
          body: "Last summer I visited Tokyo and Kyoto...",
        },
      },
      {
        value: "post-user2-food",
        label: "User2: Food Post",
        body: {
          userId: 2,
          title: "Best Pasta Recipes",
          body: "Here are my favorite pasta recipes...",
        },
      },
    ],
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
