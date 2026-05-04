import type { PollStatus, Prisma } from "@rallly/database";
import { prisma } from "@rallly/database";
import { shortUrl } from "@rallly/utils/absolute-url";

import { scorePoll, type OptionVotes } from "./scoring";

export async function getPollResults({
  pollId,
  spaceId,
}: {
  pollId: string;
  spaceId: string;
}) {
  // Run poll query and vote aggregation in parallel
  const [poll, voteCounts] = await Promise.all([
    prisma.poll.findFirst({
      where: {
        id: pollId,
        spaceId,
        deleted: false,
      },
      select: {
        id: true,
        options: {
          select: {
            id: true,
            startTime: true,
            duration: true,
          },
          orderBy: {
            startTime: "asc",
          },
        },
        _count: {
          select: {
            participants: {
              where: { deleted: false },
            },
          },
        },
      },
    }),
    prisma.vote.groupBy({
      by: ["optionId", "type"],
      where: {
        pollId,
        participant: { deleted: false },
      },
      _count: true,
    }),
  ]);

  if (!poll) {
    return null;
  }

  // Build vote counts map from groupBy results
  const votesByOption = new Map<
    string,
    Array<{ type: string; count: number }>
  >();

  for (const row of voteCounts) {
    let votes = votesByOption.get(row.optionId);
    if (!votes) {
      votes = [];
      votesByOption.set(row.optionId, votes);
    }
    votes.push({ type: row.type, count: row._count });
  }

  const getCount = (
    votes: Array<{ type: string; count: number }>,
    type: string,
  ) => votes.find((v) => v.type === type)?.count ?? 0;

  // Hand the scoring math off to the verified core in scoring.ts.
  // Score formula, highScore (Math.max), and isTopChoice are proven there.
  const scoringInput: OptionVotes[] = poll.options.map((option) => {
    const votes = votesByOption.get(option.id) ?? [];
    return {
      id: option.id,
      yes: getCount(votes, "yes"),
      ifNeedBe: getCount(votes, "ifNeedBe"),
    };
  });
  const scoring = scorePoll(scoringInput);

  // Re-attach the per-option metadata that scoring.ts doesn't track.
  // Each scoring option's id is one of poll.options[*].id by construction
  // (scoringInput was built directly from poll.options), so the lookup is total.
  const optionMeta = new Map(poll.options.map((o) => [o.id, o]));
  const options = scoring.options.map((s) => {
    const meta = optionMeta.get(s.id)!;
    return {
      id: s.id,
      startTime: meta.startTime,
      duration: meta.duration,
      votes: votesByOption.get(s.id) ?? [],
      score: s.score,
      isTopChoice: s.isTopChoice,
    };
  });

  return {
    pollId: poll.id,
    participantCount: poll._count.participants,
    options,
    highScore: scoring.highScore,
  };
}

export async function getPollParticipants({
  pollId,
  spaceId,
}: {
  pollId: string;
  spaceId: string;
}) {
  const poll = await prisma.poll.findFirst({
    where: {
      id: pollId,
      spaceId,
      deleted: false,
    },
    select: {
      id: true,
      participants: {
        where: { deleted: false },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!poll) {
    return null;
  }

  return {
    pollId: poll.id,
    participants: poll.participants,
  };
}

type PollFilters = {
  status?: PollStatus;
  page?: number;
  pageSize?: number;
  q?: string;
  member?: string;
  spaceId: string;
};

export const getPolls = async ({
  status,
  q,
  member,
  page = 1,
  pageSize = 20,
  spaceId,
}: PollFilters) => {
  // Build the where clause based on filters
  const where: Prisma.PollWhereInput = {
    spaceId,
    deletedAt: null,
    ...(status && { status }),
    ...(q && { title: { contains: q, mode: "insensitive" } }),
    ...(member && { userId: member }),
  };

  // Get total count and paginated polls in a transaction
  const [totalCount, polls] = await prisma.$transaction([
    prisma.poll.count({ where }),
    prisma.poll.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        participants: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            user: {
              select: {
                image: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const transformedPolls = polls.map((poll) => ({
    id: poll.id,
    title: poll.title,
    status: poll.status,
    createdAt: poll.createdAt,
    updatedAt: poll.updatedAt,
    user: poll.user
      ? {
          id: poll.user.id,
          name: poll.user.name,
          image: poll.user.image,
        }
      : null,
    participants: poll.participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      image: participant.user?.image ?? undefined,
    })),
    inviteLink: shortUrl(`/invite/${poll.id}`),
  }));

  const totalPages = Math.ceil(totalCount / pageSize);
  const hasNextPage = page < totalPages;

  return {
    polls: transformedPolls,
    total: totalCount,
    totalPages,
    hasNextPage,
    currentPage: page,
  };
};
