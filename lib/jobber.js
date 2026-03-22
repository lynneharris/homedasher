// lib/jobber.js
// Jobber GraphQL API client

async function jobberQuery(query, variables = {}) {
  const token = process.env.JOBBER_ACCESS_TOKEN;
  const url = process.env.JOBBER_API_URL;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-JOBBER-GRAPHQL-VERSION': '2026-03-10',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  console.log('Jobber response status:', res.status);
  console.log('Jobber response body:', JSON.stringify(data));
  if (data.errors) throw new Error(data.errors[0].message);
  if (!data.data) throw new Error('No data returned from Jobber API');
  return data.data;
}

// Create a new client in Jobber
// Now returns propertyId (needed for jobCreate)
async function createJobberClient({ firstName, lastName, email, phone, address }) {
  const mutation = `
    mutation CreateClient($input: ClientCreateInput!) {
      clientCreate(input: $input) {
        client {
          id
          firstName
          lastName
          clientProperties { nodes { id } }
        }
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
      billingAddress: address ? { street1: address } : undefined,
    }
  });
  if (data.clientCreate.userErrors.length > 0) {
    throw new Error(data.clientCreate.userErrors[0].message);
  }
  const client = data.clientCreate.client;
  // Return client id plus the default property id
  return {
    id: client.id,
    firstName: client.firstName,
    lastName: client.lastName,
    propertyId: client.clientProperties.nodes[0]?.id,
  };
}

// Create a job in Jobber linked to a client property
// Uses propertyId (not clientId) per JobCreateAttributes schema
// invoicingType VISIT_BASED + invoicingSchedule NEVER because Stripe handles payment at booking
async function createJobberJob({ propertyId, title, instructions, startAt, duration }) {
  const mutation = `
    mutation CreateJob($input: JobCreateAttributes!) {
      jobCreate(input: $input) {
        job { id jobNumber title }
        userErrors { message path }
      }
    }
  `;
  const input = {
    propertyId,
    title,
    invoicing: {
      invoicingType: 'VISIT_BASED',
      invoicingSchedule: 'NEVER',
    },
  };
  if (instructions) input.instructions = instructions;
  if (startAt) {
    input.timeframe = {
      startAt,
      endAt: new Date(new Date(startAt).getTime() + duration * 60 * 60 * 1000).toISOString(),
    };
  }
  const data = await jobberQuery(mutation, { input });
  if (data.jobCreate.userErrors.length > 0) {
    throw new Error(data.jobCreate.userErrors[0].message);
  }
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

// Get all jobs for a specific date
async function getJobsForDate(date) {
  const query = `
    query JobsForDate {
      jobs(filter: { startAt: { after: "${date}T00:00:00Z", before: "${date}T23:59:59Z" } }) {
        nodes {
          id
          startAt
          endAt
          title
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
  getJobsForDate,
};
