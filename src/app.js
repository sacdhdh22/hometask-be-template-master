const express = require("express");
const bodyParser = require("body-parser");
const { Op, Sequelize } = require("sequelize");
const { sequelize } = require("./model");
const { getProfile } = require("./middleware/getProfile");
const app = express();
app.use(bodyParser.json());
app.set("sequelize", sequelize);
app.set("models", sequelize.models);

/**
 * FIX ME!
 * @returns contract by id
 */
app.use(getProfile);
//app.use("/", require("./routes/index"));

app.get("/contracts/:id", async (req, res) => {
  if (!req.params || !req.params.id) {
    res.status(400).json({ error: "Bad Request" });
  }
  const { Contract } = req.app.get("models");
  const { id } = req.params;
  const contract = await Contract.findOne({
    where: { id },
    include: [
      {
        model: sequelize.models.Profile,
        as: "Contractor",
        attributes: [],
      },
    ],
    raw: true,
  });
  if (!contract) return res.status(404).end();
  if (contract.ContractorId !== req.profile.id) return res.status(401).end();
  res.json(contract);
});

app.get("/contracts", async (req, res) => {
  const { Contract } = req.app.get("models");
  console.log("req.profile.id", req.profile.id);
  const contract = await Contract.findAll({
    where: {
      [Sequelize.Op.or]: [
        { ClientId: req.profile.id },
        { ContractorId: req.profile.id },
      ],
      status: {
        [Op.in]: ["new", "in_progress"],
      },
    },
  });
  if (!contract) return res.status(404).end();
  res.json(contract);
});

app.get("/jobs/unpaid", async (req, res) => {
  const { Contract, Job } = req.app.get("models");
  const unpaidJobs = await Contract.findAll({
    where: {
      [Sequelize.Op.or]: [
        { ClientId: req.profile.id },
        { ContractorId: req.profile.id },
      ],
      status: {
        [Op.in]: ["new", "in_progress"],
      },
    },
    include: [
      {
        model: Job,
        attributes: ["description", "price", "paid", "paymentDate","createdAt","updatedAt"],
        where: {
          paid: true,
        },
      },
    ],
    raw: true,
  });
  if (!unpaidJobs) return res.status(404).end();
  console.log("unpaidJobs", unpaidJobs);
  //const jobsDetails = unpaidJobs.flatMap((contract) => contract.Jobs);
  res.json(unpaidJobs);
});

const performTransaction = async (req, res) => {
  const { Contract, Job, Profile } = req.app.get("models");
  let t; // Declare t outside the try block

  try {
    t = await sequelize.transaction({
      isolationLevel: Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED,
    });

    const job = await Job.findAll({
      attributes: [
        [
          sequelize.fn(
            "SUM",
            sequelize.literal('CAST("Job"."price" AS DECIMAL)')
          ),
          "totalAmount",
        ],
      ],
      where: {
        [Op.or]: [{ paid: null }, { paid: false }],
      },
      include: [
        {
          model: Contract,
          where: {
            ClientId: req.params.userId,
          },
        },
      ],
      raw: true,
      transaction: t,
    });

    console.log("Result:", job);

    const totalAmount =
      job.length > 0 ? parseFloat(job[0].totalAmount) || 0 : 0;
    const depositAmount = totalAmount * 0.25;
    console.log("depositAmount", depositAmount);

    await Profile.update(
      { balance: depositAmount },
      {
        where: { id: req.params.userId },
        transaction: t,
      }
    );

    // Commit the transaction
    await t.commit();
    console.log("Transaction committed successfully");
    res.sendStatus(204);
  } catch (error) {
    console.log("Transaction failed:", error);

    // If an error occurs, roll back the transaction
    if (t) {
      await t.rollback();
    }

    return res.status(500).json({ error: "Transaction failed" });
  }
};

app.get("/balances/deposit/:userId", async (req, res) => {
  performTransaction(req, res);

  //   sequelize
  //     .transaction(async (t) => {
  //       try {
  //         const job = await Job.findAll({
  //           attributes: [
  //             [
  //               sequelize.fn(
  //                 "SUM",
  //                 sequelize.literal('CAST("Job"."price" AS DECIMAL)')
  //               ),
  //               "totalAmount",
  //             ],
  //           ],
  //           where: {
  //             [Op.or]: [{ paid: null }, { paid: false }],
  //           },
  //           include: [
  //             {
  //               model: Contract,
  //               where: {
  //                 ClientId: req.params.userId,
  //               },
  //             },
  //           ],
  //           raw: true,
  //           transaction: t,
  //         });
  //         //const totalAmount = jobs.reduce((acc, job) => acc + job.price, 0);
  //         console.log("Result:", job);

  //         const totalAmount =
  //           job.length > 0 ? parseFloat(job[0].totalAmount) || 0 : 0;

  //         const depositAmount = totalAmount * 0.25;
  //         console.log("depositAmount", depositAmount);
  //         await Profile.update(
  //           { balance: depositAmount },
  //           {
  //             where: { id: req.params.userId },
  //             transaction: t,
  //           }
  //         );
  //         await t.commit();
  //       } catch (err) {
  //         console.log("err", err);
  //         return res.status(404).end();
  //       }
  //     })
  //     .then(() => {
  //       // This block is executed if the transaction is successful
  //       console.log("Transaction successful");
  //     })
  //     .catch((err) => {
  //       // This block is executed if there is an error outside the transaction
  //       console.error("Transaction initiation error:", err);
  //       return res.status(500).json({ error: "Transaction initiation failed" });
  //     });
});

app.get("/admin/best-profession", async (req, res) => {
  const { Contract, Job, Profile } = req.app.get("models");
  try {
    const startDate = req.query.start;
    const endDate = req.query.end;
    const bestProfession = await Job.findAll({
      where: {
        paymentDate: {
          [Sequelize.Op.between]: [startDate, endDate],
        },
        paid: true,
      },
      attributes: [
        [
          sequelize.fn(
            "SUM",
            sequelize.literal('CAST("Job"."price" AS DECIMAL)')
          ),
          "totalEarned",
        ],
      ],
      include: [
        {
          model: Contract,
          as: "Contract",
          attributes: [],
          required: true,
          include: [
            {
              model: Profile,
              as: "Contractor",
              attributes: ["profession"],
              required: true,
            },
          ],
        },
      ],
      group: ["Contract.Contractor.profession"],
      order: [[sequelize.literal("totalEarned"), "DESC"]],
      limit: 1,
      raw: true,
    });
    if (bestProfession.length === 0) return res.json(bestProfession);
    const output = {
      profession: bestProfession[0]["Contract.Contractor.profession"]
        ? bestProfession[0]["Contract.Contractor.profession"]
        : null,
      totalAmount: bestProfession[0].totalEarned
        ? bestProfession[0].totalEarned
        : 0,
    };
    res.json(output);
  } catch (error) {
    console.error("Error fetching best profession:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/admin/best-clients", async (req, res) => {
  const { Contract, Job, Profile } = req.app.get("models");
  try {
    const startDate = req.query.start;
    const endDate = req.query.end;
    const limit = req.query.limit;
    const bestProfession = await Job.findAll({
      where: {
        paymentDate: {
          [Sequelize.Op.between]: [startDate, endDate],
        },
        paid: true,
      },
      attributes: [
        [
          sequelize.fn(
            "SUM",
            sequelize.literal('CAST("Job"."price" AS DECIMAL)')
          ),
          "totalSpent",
        ],
      ],
      include: [
        {
          model: Contract,
          as: "Contract",
          attributes: [],
          required: true,
          include: [
            {
              model: Profile,
              as: "Client",
              attributes: ["firstName", "lastName"],
              required: true,
            },
          ],
        },
      ],
      group: ["Contract.Client.id"],
      order: [[sequelize.literal("totalSpent"), "DESC"]],
      limit: limit,
      raw: true,
    });
    if (bestProfession.length === 0) return res.json(bestProfession);
    const resp = [];
    for (let i = 0; i < bestProfession.length; i++) {
      const output = {
        id: bestProfession[0]["Contract.Client.id"],
        paid: bestProfession[0].totalSpent,
        fullName:
          bestProfession[0]["Contract.Client.firstName"] +
          " " +
          bestProfession[0]["Contract.Client.lastName"],
      };
      resp.push(output);
    }

    res.json(resp);
  } catch (error) {
    console.error("Error fetching best profession:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = app;
