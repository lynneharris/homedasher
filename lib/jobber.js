// lib/jobber.js
// Jobber GraphQL API client

const JOBBER_API_URL = process.env.JOBBER_API_URL;
const JOBBER_ACCESS_TOKEN = process.env.JOBBER_ACCESS_TOKEN;

async function jobberQuery(query, variables = {}) {
  const res = await fetch(JOBBER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JOBBER_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
}

// Create a new client in Jobber
async function createJobberClient({ firstName, lastName, email, phone, address }) {
  const mutation = `
    mutation CreateClient($input: ClientCreateInput!) {
      clientCreate(input: $input) {
        client { id firstName lastName }
        userErrors { message path }
      }
    }
  `;
  const [first, ...rest] = firstName.split(' ');
  const last = lastName || rest.join(' ') || '';
  const data = await jobberQuery(mutation, {
    input: {
      firstName: first,
      lastName: last,
      emails: [{ description: 'MAIN', primary: true, address: email }],
      phones: phone ? [{ description: 'MAIN', primary: true, number: phone }] : [],
      billingAddress: address ? { street: address } : undefined,
    }
  });
  return data.clientCreate.client;
}

// Create a job in Jobber linked to a client
async function createJobberJob({ clientId, title, instructions, startAt, duration }) {
  const mutation = `
    mutation CreateJob($input: JobCreateInput!) {
      jobCreate(input: $input) {
        job { id jobNumber title }
        userErrors { message path }
      }
    }
  `;
  const data = await jobberQuery(mutation, {
    input: {
      clientId,
      title,
      instructions,
      startAt,
      endAt: new Date(new Date(startAt).getTime() + duration * 60 * 60 * 1000).toISOString(),
    }
  });
  return data.jobCreate.job;
}

// Add a note to a client record (chore list)
async function addClientNote({ clientId, note }) {
  const mutation = `
    mutation AddNote($clientId: EncodedId!, $note: String!) {
      noteCreate(input: { subjectId: $clientId, subjectType: CLIENT, body: $note }) {
        note { id }
        userErrors { message }
      }
    }
  `;
  return await jobberQuery(mutation, { clientId, note });
}

// Assign a job to a worker
async function assignJobToWorker({ jobId, workerId }) {
  const mutation = `
    mutation AssignJob($jobId: EncodedId!, $assigneeIds: [EncodedId!]!) {
      jobUpdate(id: $jobId, input: { assigneeIds: $assigneeIds }) {
        job { id }
        userErrors { message }
      }
    }
  `;
  return await jobberQuery(mutation, { jobId, assigneeIds: [workerId] });
}

// Get unassigned jobs
async function getUnassignedJobs() {
  const query = `
    query UnassignedJobs {
      jobs(filter: { assigneeIds: [] }) {
        nodes {
          id
          jobNumber
          title
          startAt
          endAt
          instructions
          client {
            id
            name
            billingAddress { street city province postalCode }
          }
        }
      }
    }
  `;
  const data = await jobberQuery(query);
  return data.jobs.nodes;
}

module.exports = {
  createJobberClient,
  createJobberJob,
  addClientNote,
  assignJobToWorker,
  getUnassignedJobs,
};
