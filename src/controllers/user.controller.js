import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResonse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import { json } from "express";
import mongoose from "mongoose";

// generate token start
const generateAccessTokenAndRefreshToken = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // inserting refresh token in db
    user.refreshToken = refreshToken; // in user model there is a field called refresh token
    await user.save({ validateBeforeSave: false }); // done this because in user model like password field is true , save the refresh token without any validation in the db

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "something went wrong while generating access and refresh token"
    );
  }
};
// generate token end

const registerUser = asyncHandler(async (req, res) => {
  // res.status(200).json({
  //     message:"OK"
  // })

  /*                       Steps to register
    1. get user details from frontend.
    2. validation - not empty, correct format etc.
    3. check if user already exist. : check using username and email.
    4. check for images, check for avatar(required).
    5. upload them to cloudinary, check avatar on cloudinary
    6. create user object - create entry in db.
    7. remove password and refresh token field from password.
    8. check for user creation.
    9. return res
    */

  // Step1 done
  const { fullName, email, username, password } = req.body;
  //  console.log("fullName: ",fullName);

  // Step 2 validation improved technique with "some" method
  if (
    [fullName, email, username, password].some((field) => field?.trim() === "") //field he aur trim kane ke baad bhi empty he the true
  ) {
    throw new ApiError(400, "All fields are required");
  }

  // step 3 user exist or not
  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new ApiError(409, "User with email or username already exit");
  }

  // console.log(req.files);
  const avatarLocalPath = req.files?.avatar[0]?.path; // extract the path from local files in public
  // const coverImageLocalPath = req.files?.coverImage[0]?.path;

  let coverImageLocalPath;
  if (
    req.files &&
    Array.isArray(req.files.coverImage) &&
    req.files.coverImage.length > 0
  ) {
    coverImageLocalPath = req.files.coverImage[0].path;
  }

  //Step 4
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required");
  }

  //Step 5 upload on cloudinary
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  //Step 5 check for avatar
  if (!avatar) {
    throw new ApiError(400, "Avatar file is required");
  }

  //Step 6
  const user = await User.create({
    fullName,
    avatar: avatar.url, //cloudinary return a response and we can get url link from that response
    coverImage: coverImage?.url || "", //if coverImage is there then take out url else remain empty.
    email,
    password,
    username: username.toLowerCase(),
  });

  // Step 8 :to check if user created or not and also Step 7
  // we will get a response in createdUser of all the fields excluding two fields i.e password and refreshToken
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while regestering the user");
  }

  //Step 9:

  return res
    .status(201)
    .json(new ApiResonse(200, createdUser, "User registered successfully"));
});

//  ************  Login User Starts
const loginUser = asyncHandler(async (req, res) => {
  /*Psedo Code for this:-
          1. req.body ->data
          2. username or email
          3. find the user
          4. password check
          5. access and refresh 
          6. Send these token using cookies
          */

  // step 1
  const { username, email, password } = req.body;
  // console.log(email);
  //step 2
  if (!username && !email) {
    // if both are empty
    throw new ApiError(400, "Username and email is required.");
  }

  // if (!(username || email)) {
  //   throw new ApiError(400, "Username or email is required.");
  // }

  //step 3
  const user = await User.findOne({
    // find if email or username exist or not
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  // step 4 password check

  // always remember all the methods created in mongoose user model is available in user instance you get from db not in User
  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  // step 5 if password is correct generate tokens , as gerenating tokens process repeat multiple times so make a separate method for them
  const { accessToken, refreshToken } =
    await generateAccessTokenAndRefreshToken(user._id);

  // we have to update the user because refresh token is inserted , so have two options either update or call function one more time
  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  //cookies
  const options = {
    // can see but not be able to modifed from frontend , only from server side
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResonse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User logged in successfully"
      )
    );
});
//  ************  Login User Ends

// *********** Logout User
const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      // $set: {
      //   refreshToken: undefined,
      // },
      $unset: {
        refreshToken: 1, //this removes the field from document
      },
    },
    {
      new: true, //jo return me response milega usme new updated value miligi jisme refresh token undefined hoga na ki uski purani value
    }
  );

  //cookies
  const options = {
    // can see but not be able to modifed from frontend , only from server side
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResonse(200, {}, "User logged out successfully"));
});

// making of endpoint for user so that it can gereate a refresh token
const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken; //koyi cookies se bhej raha he ya phir mobile app  se access kar raha he

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request");
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    const user = await User.findById(decodedToken?._id);

    if (!user) {
      throw new ApiError(401, "Invalid refresh token.");
    }

    // matching the token from user giving incoming and we have saved in user in gereateAccessAndRefreshToken
    if (incomingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or used");
    }

    //if token is matched and verified then gerneate new tokens
    const options = { httpOnly: true, secure: true };

    const { accessToken, newRefreshToken } =
      await generateAccessTokenAndRefreshToken(user._id); //upar se jo hamne user find kiya tha findById

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResonse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          "Access token refreshed"
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token");
  }
});

// change the password
const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  // First  want user so that we can verify the password,  we can get user from auth middleware as he is able to change the password so user is logged in
  const user = await User.findById(req.user?._id);
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

  if (!isPasswordCorrect) {
    throw new ApiError(400, "Invalid old password");
  }

  // if old password is correct change it with new password
  user.password = newPassword;
  await user.save({ validateBeforeSave: false }); //pre hook is called in user model (hook works = if password is mot modified dont do anything just return but if it change bycrypt it and save it before moving on)

  return res
    .status(200)
    .json(new ApiResonse(200, {}, "Password change successfully")); // {} => defines not sending any data
});

// get current user
const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResonse(200, req.user, "Current user fetched successfully"));
});

// update account details
const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullName, email } = req.body;

  if (!fullName || !email) {
    throw new ApiError(400, "All field are required");
  }
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullName,
        email: email, // two methods
      },
    },
    { new: true } //update hone ke baad jo information he vo return hoti he
  ).select("-password");

  return (
    res.status(200),
    json(new ApiResonse(200, user, "Account details updated successfully"))
  );
});

// update avatar
const updateUserAvatar = asyncHandler(async (req, res) => {
  // 1. nulter se files
  //  2. user login or not

  const avatarLocalPath = req.file?.path; // local me multer ne upload kar di hogi file
  // console.log(avatarLocalPath);

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is missing");
  }

  // upload the local file on cloudinary
  const avatar = await uploadOnCloudinary(avatarLocalPath);

  if (!avatar.url) {
    throw new ApiError(400, "Error while uploading the avatar");
  }

  //update in db
  const user = await User.findByIdAndUpdate(
    req.user?._id, //optionally wrapped
    {
      $set: {
        avatar: avatar.url, // dont use avatar:avatar because avatar contals full objects and we need only url
      },
    },
    { new: true }
  ).select("-password");

  // TODO: - delete old image

  return res
    .status(200)
    .json(new ApiResonse(200, user, "Avatar updated successfuly"));
});

// update coverImage
const updateUserCoverImage = asyncHandler(async (req, res) => {
  // 1. nulter se files
  //  2. user login or not

  const coverImageLocalPath = req.file?.path; // local me multer ne upload kar di hogi file
  // console.log(coverImageLocalPath);

  if (!coverImageLocalPath) {
    throw new ApiError(400, "Cover image file is missing");
  }

  // upload the local file on cloudinary
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!coverImage.url) {
    throw new ApiError(400, "Error while uploading the cover image");
  }

  //update in db
  const user = await User.findByIdAndUpdate(
    req.user?._id, //optionally wrapped
    {
      $set: {
        coverImage: coverImage.url, // dont use avatar:avatar because avatar contals full objects and we need only url
      },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResonse(200, user, "Cover image updated successfuly"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
  /* Note we did not use array to store the no. of subscriber are there because imagine that a channel had 1M sub and if one user unsubcribe than it will lead to expensive and time consuming operation so incase we use pipelines and make a separate subscription model */

  const { username } = req.params; // getting user from url not req.body because in youtube the channel profile has a url like /dr
  // console.log(req.params);
  if (!username?.trim()) {
    //if username he to optionally trim
    throw new ApiError(400, "Username is missing");
  }

  // User.aggregate([{},{}])  //when aggregate pipelines it returns Array

  // Aggregation pipeline
  const channel = await User.aggregate([
    // ist document
    {
      //ist pipeline
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      // 2nd pipeline to get subscribers
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "channel", // after getting channels we get subscribers
        as: "subscribers", //field is created with this name
      },
    },
    {
      // 3rd pipeline to get a user subscribed to how many channels
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribedTo",
      },
    },
    {
      //4th pipeline : To add  additional fields that created in above pipeline into user db model
      $addFields: {
        subscribersCount: {
          $size: "$subscribers", // subscribeCount field add hoygi , jo count kari ki kitne documents he $subscribers field ke usko count kardega
        },
        channelsSubscribedToCount: {
          $size: "$subscribedTo",
        },
        isSubscribed: {
          $cond: {
            if: { $in: [req.user?._id, "$subscribers.subscriber"] },
            then: true,
            else: false,
          },
        },
      },
    },
    {
      //5th pipeline: to give selected things
      $project: {
        fullName: 1,
        username: 1,
        subscribersCount: 1,
        channelsSubscribedToCount: 1,
        isSubscribed: 1,
        avatar: 1,
        coverImage: 1,
        email: 1,
      },
    },
  ]);

  // console.log("channel is ", channel); //returns array
  if (!channel?.length) {
    throw new ApiError(404, " Channel does not exist");
  }

  return res
    .status(200)
    .json(new ApiResonse(200, channel[0], "User channel fetched successfully")); // return Ist object of channel array because we are matching one user
});

// Users watch history  [user model se watchHistory nikali then find all videos model documents using lookUp but one field owner is not fetched yet so we create a sub pipeline lookup to find the user ]
const getWatchedHistory = asyncHandler(async (req, res) => {
  // req.user._id; => we get string important

  // pipeline
  const user = await User.aggregate([
    {
      // pipeline Ist to match/get user
      $match: {
        _id: new mongoose.Types.ObjectId(req.user._id),
      },
    },
    {
      $lookup: {
        from: "videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistory ",
        pipeline: [
          //nested pipeline in lookup beacuse uptil now we get the videos but to get the owner field in vidoes we have to make a nested pipeline.

          {
            // right now we are in videos now where we have to lookup => In users
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: "owner", // we get whole user information but not need all of it so we use another pipeline to select particular fields
              pipeline: [
                {
                  $project: {
                    fullName: 1,
                    username: 1,
                    avatar: 1,
                  },
                },
              ],
            },
          },
          // pipeline to make frontend work easier
          {
            $addFields: {
              owner: {
                //existing field owner override
                $first: "$owner", //To take out array's first value from owner
              },
            },
          },
        ],
      },
    },
  ]);

  return res
    .status(200)
    .json(
      new ApiResonse(
        200,
        user[0].watchHistory,
        "Watched History fetched successfully"
      )
    ); // only giving watchHistory
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchedHistory,
};
