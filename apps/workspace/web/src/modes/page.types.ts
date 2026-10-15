export type HomeView = "recent" | "owned" | "shared";

export interface HomePageProps {
  readonly view?: HomeView;
}

export type SpacePageView = "files" | "prs" | "apps";
export interface SpacePageProps {
  readonly spaceId: string;
  readonly view?: SpacePageView;
}
